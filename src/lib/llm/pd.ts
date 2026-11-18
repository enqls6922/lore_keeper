import { GoogleGenerativeAI, SchemaType, type GenerationConfig } from "@google/generative-ai";

import {
  COACHING_SUMMARY,
  SUMMARY_LIMIT,
  clipText,
  hasIssueKeyword,
  hasQuestionMark,
  mentionsLoyalty,
} from "@/lib/chat-radar";

const MODEL_NAME = "gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `너는 한국어 인터넷 방송의 실시간 PD다.
스트리머가 바로 읽는 개조식 팩트만 적는다.

반드시 지킬 규칙:
- 추천 멘트, 대본, 리액션 대사는 쓰지 않는다.
- summary는 공백 포함 35자 이내다.
- 채팅과 후원 메시지에 없는 사건과 숫자를 만들지 않는다.
- 누적 치즈, 단골, 방문 횟수, 개인 사연은 말하지 않는다.
- 마크다운과 머리말은 넣지 않는다.`;

const summaryConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: { type: SchemaType.STRING, description: "35자 이내 핵심 한 줄" },
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
      summary: { type: SchemaType.STRING, description: "35자 이내. shouldAlert가 false면 빈 문자열" },
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
  const lines = messages.slice(-limit);
  return lines.length > 0 ? lines.map((message) => `- ${message}`).join("\n") : "- (최근 채팅 없음)";
}

function acceptSummary(text: unknown): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > SUMMARY_LIMIT || mentionsLoyalty(trimmed)) {
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
  const useful = [...messages].reverse().find((line) => line.replace(/[ㅋㅎㅠㅜ!?.,~\s]/g, "").length >= 2);
  return clipText(useful || "채팅이 갑자기 늘었다", SUMMARY_LIMIT);
}

/** 화력이 터진 이유를 채팅에 있는 말로만 한 줄 요약한다. */
export async function summarizeSpike(messages: string[]): Promise<string> {
  const fallback = fallbackSpike(messages);
  const raw = await askModel(
    `[채팅 화력]\n최근 60초 채팅이 직전보다 급증했다. 채팅에 적힌 원인만 35자로 적어라.\n\n${chatBlock(messages, 40)}`,
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
    return acceptSummary(parsed.summary) ?? fallback;
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
  const sample = messages.find((message) => (category === "ISSUE" ? hasIssueKeyword(message) : hasQuestionMark(message)));
  return {
    shouldAlert: true,
    category,
    summary: clipText(sample || (category === "ISSUE" ? "방송 상태 문의가 반복된다" : "같은 질문이 반복된다"), SUMMARY_LIMIT),
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
    const summary = acceptSummary(parsed.summary);
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
  const message = input.message.trim();
  if (message.length > 0 && !mentionsLoyalty(message)) {
    return clipText(message, SUMMARY_LIMIT);
  }
  return clipText(`${input.cheeseAmount.toLocaleString("ko-KR")}치즈 후원`, SUMMARY_LIMIT);
}

/** 이번 후원 메시지와 직전 채팅 20개의 연결만 35자로 줄인다. */
export async function summarizeDonation(input: DonationDraftInput): Promise<string> {
  const fallback = fallbackDonation(input);
  const who = input.anonymous ? "익명의 후원자" : input.nickname;
  const raw = await askModel(
    `[이번 후원]
표시 이름: ${who}
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${input.message || "(메시지 없음)"}

직전 채팅 최대 20개:
${chatBlock(input.recentChats, 20)}

후원 핵심과 직전 채팅 연결만 35자로 적어라. 대본은 쓰지 마라.`,
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
    return acceptSummary(parsed.summary) ?? fallback;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 후원 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}
