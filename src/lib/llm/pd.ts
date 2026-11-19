import { GoogleGenerativeAI, SchemaType, type GenerationConfig } from "@google/generative-ai";

import {
  COACHING_SUMMARY,
  SUMMARY_LIMIT,
  clipText,
  hasIssueKeyword,
  hasQuestionMark,
  mentionsLoyalty,
} from "@/lib/chat-radar";
import { stripChzzkEmotes } from "@/lib/chzzk/text";

const MODEL_NAME = "gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `너는 한국어 인터넷 방송의 실시간 PD다.
스트리머에게 상황을 보고하는 개조식 한 줄만 적는다.

반드시 지킬 규칙:
- 절대 금지: 특정 시청자의 채팅 문장 원문, 따옴표, 물음표, ㅋㅋㅋ ㅎ ㅠ 같은 감탄사를 그대로 복사하지 않는다.
- 출력 형식: 방송 PD 보고체. 공백 포함 25자 이내. 어미는 ~함, ~폭발, ~의문 제기처럼 상황 보고로 끝낸다.
- 예: "진행 방식에 시청자 의문 제기", "특정 드립에 채팅창 폭소 폭발", "이모티콘 및 환호 도배 구간".
- 추천 멘트, 대본, 리액션 대사는 쓰지 않는다.
- 채팅에 없는 사건과 숫자를 만들지 않는다. 후원 금액은 입력에 있는 숫자만 쓴다.
- 누적 치즈, 단골, 방문 횟수, 개인 사연은 말하지 않는다.
- 마크다운과 머리말은 넣지 않는다.`;

const summaryConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: { type: SchemaType.STRING, description: "25자 이내. 채팅 원문 금지. ~함/~폭발/~의문 제기" },
    },
    required: ["summary"],
  },
};

const issueConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      shouldAlert: { type: SchemaType.BOOLEAN, description: "진짜 공통 질문이나 방송 이슈일 때만 true" },
      category: { type: SchemaType.STRING, description: "ISSUE 또는 QUESTION" },
      summary: { type: SchemaType.STRING, description: "25자 이내 보고체. shouldAlert가 false면 빈 문자열" },
    },
    required: ["shouldAlert", "category", "summary"],
  },
};

export interface DonationDraftInput {
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats: string[];
  anonymous: boolean;
}

export interface IssueJudgement {
  shouldAlert: boolean;
  category: "ISSUE" | "QUESTION";
  summary: string;
}

function readApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function chatBlock(messages: string[], limit: number): string {
  const lines = messages.map(stripChzzkEmotes).filter((line) => line.length > 0).slice(-limit);
  return lines.length > 0 ? lines.map((message) => `- ${message}`).join("\n") : "- (최근 채팅 없음)";
}

function laughs(text: string): boolean {
  return /[ㅋㅎㅠㅜ]{2,}/.test(text);
}

function copiesSource(summary: string, sources: string[]): boolean {
  const compact = summary.replace(/\s+/g, "");
  if (compact.length < 4) {
    return true;
  }
  return sources.some((source) => {
    const cleaned = stripChzzkEmotes(source).replace(/\s+/g, "");
    if (cleaned.length < 4) {
      return false;
    }
    return cleaned.includes(compact) || compact.includes(cleaned);
  });
}

function acceptSummary(text: unknown, sources: string[]): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = stripChzzkEmotes(text);
  if (
    trimmed.length === 0 ||
    Array.from(trimmed).length > SUMMARY_LIMIT ||
    mentionsLoyalty(trimmed) ||
    laughs(trimmed) ||
    /[?？]/.test(trimmed) ||
    copiesSource(trimmed, sources)
  ) {
    return null;
  }
  return trimmed;
}

async function askModel(prompt: string, config: GenerationConfig): Promise<string | null> {
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error("[pd] GEMINI_API_KEY가 없어 사실 데이터로 요약합니다.");
    return null;
  }
  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: config,
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 모델 호출에 실패해 사실 데이터로 요약합니다. ${message}`);
    return null;
  }
}

function fallbackSpike(messages: string[]): string {
  const emoteOnly = messages.filter((line) => line.trim().length > 0 && stripChzzkEmotes(line).length === 0).length;
  const laugh = messages.filter((line) => laughs(line)).length;
  const questions = messages.filter(hasQuestionMark).length;
  if (emoteOnly >= 3) {
    return "이모티콘 및 환호 도배 구간";
  }
  if (laugh >= 3) {
    return "특정 드립에 채팅창 폭소 폭발";
  }
  if (questions >= 3) {
    return "같은 내용에 시청자 의문 제기";
  }
  return "채팅 화력 급증함";
}

/** 화력이 터진 이유를 채팅에 있는 말로만 한 줄 요약한다. */
export async function summarizeSpike(messages: string[]): Promise<string> {
  const fallback = fallbackSpike(messages);
  const raw = await askModel(
    `[채팅 화력]\n최근 60초 채팅이 직전보다 급증했다. 시청자 문장을 베끼지 말고 25자 이내 보고체로 적어라.\n\n${chatBlock(messages, 40)}`,
    summaryConfig,
  );
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallback;
    }
    return acceptSummary(parsed.summary, messages) ?? fallback;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 화력 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}

function fallbackIssue(messages: string[]): IssueJudgement {
  const issueHits = messages.filter(hasIssueKeyword).length;
  const questionHits = messages.filter(hasQuestionMark).length;
  if (issueHits + questionHits < 3) {
    return { shouldAlert: false, category: "QUESTION", summary: "" };
  }
  const category = issueHits >= questionHits && issueHits > 0 ? "ISSUE" : "QUESTION";
  return {
    shouldAlert: true,
    category,
    summary: category === "ISSUE" ? "방송 상태에 시청자 의문 제기" : "같은 질문에 시청자 의문 제기",
  };
}

/** 키워드가 보여도 잡담이면 shouldAlert를 false로 둔다. */
export async function judgeIssue(messages: string[]): Promise<IssueJudgement> {
  const fallback = fallbackIssue(messages);
  const raw = await askModel(
    `[집단 의도]\n아래 채팅이 실제 방송 사고(ISSUE)이거나 여러 사람이 같은 질문을 하는지(QUESTION)만 판단해라. 잡담이면 shouldAlert는 false다.\n\n${chatBlock(messages, 40)}`,
    issueConfig,
  );
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.shouldAlert !== "boolean") {
      return fallback;
    }
    if (!parsed.shouldAlert) {
      return { shouldAlert: false, category: "QUESTION", summary: "" };
    }
    const category = parsed.category === "ISSUE" ? "ISSUE" : parsed.category === "QUESTION" ? "QUESTION" : null;
    const summary = acceptSummary(parsed.summary, messages);
    if (!category || !summary) {
      return fallback;
    }
    return { shouldAlert: true, category, summary };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 이슈 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}

export function coachingSummary(): string {
  return clipText(COACHING_SUMMARY, SUMMARY_LIMIT);
}

function fallbackDonation(input: DonationDraftInput): string {
  const message = stripChzzkEmotes(input.message);
  if (message.length > 0 && !mentionsLoyalty(message)) {
    return "후원과 함께 응원함";
  }
  return clipText(`${input.cheeseAmount.toLocaleString("ko-KR")}치즈 후원함`, SUMMARY_LIMIT);
}

/** 이번 후원과 직전 채팅을 25자 보고체로 줄인다. 원문은 베끼지 않는다. */
export async function summarizeDonation(input: DonationDraftInput): Promise<string> {
  const fallback = fallbackDonation(input);
  const who = input.anonymous ? "익명의 후원자" : input.nickname;
  const raw = await askModel(
    `[이번 후원]
표시 이름: ${who}
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${stripChzzkEmotes(input.message) || "(메시지 없음)"}

직전 채팅 최대 20개:
${chatBlock(input.recentChats, 20)}

시청자 문장과 감탄사를 베끼지 말고, 후원 상황만 25자 보고체로 적어라.`,
    summaryConfig,
  );
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallback;
    }
    return acceptSummary(parsed.summary, [input.message, ...input.recentChats]) ?? fallback;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 후원 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}
