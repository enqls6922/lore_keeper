import { GoogleGenerativeAI, SchemaType, type GenerationConfig } from "@google/generative-ai";

import {
  HIGH_CHEESE,
  REASON_LIMIT,
  SUMMARY_LIMIT,
  clipText,
  mentionsLoyalty,
  type RadarSignal,
} from "@/lib/chat-radar";

const MODEL_NAME = "gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `너는 한국어 인터넷 방송의 실시간 PD다.
스트리머가 0.5초 안에 읽는 개조식 팩트만 적는다.

반드시 지킬 규칙:
- 추천 멘트, 대본, 리액션 대사는 쓰지 않는다.
- summary는 공백 포함 35자 이내다.
- reason은 공백 포함 40자 이내의 편집 마커 설명이다. 채팅에 있는 사건만 적는다.
- 채팅과 후원 메시지에 없는 보스전, 웃음, 숫자, 인물을 만들지 않는다.
- 누적 치즈, 단골, 방문 횟수, 시청자 과거 사연은 절대 말하지 않는다.
- 마크다운과 머리말은 넣지 않는다.`;

const radarConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: { type: SchemaType.STRING, description: "35자 이내 상황 요약" },
      reason: { type: SchemaType.STRING, description: "40자 이내 편집 마커 이유" },
    },
    required: ["summary", "reason"],
  },
};

const donationConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: { type: SchemaType.STRING, description: "35자 이내 이번 후원 핵심과 채팅 연결" },
    },
    required: ["summary"],
  },
};

export interface RadarDraft {
  summary: string;
  reason: string;
}

export interface DonationDraftInput {
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats: string[];
  anonymous: boolean;
}

function readApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatAmount(value: number): string {
  return value.toLocaleString("ko-KR");
}

function chatBlock(messages: string[]): string {
  const lines = messages.slice(-40);
  return lines.length > 0 ? lines.map((message) => `- ${message}`).join("\n") : "- (최근 채팅 없음)";
}

function acceptLine(text: unknown, limit: number): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > limit || mentionsLoyalty(trimmed)) {
    return null;
  }
  return trimmed;
}

function fallbackRadar(signal: RadarSignal, messages: string[]): RadarDraft {
  const last = messages[messages.length - 1] ?? "";
  if (signal === "COACHING") {
    return { summary: clipText(last || "훈수와 논쟁이 겹쳤다", SUMMARY_LIMIT), reason: "훈수와 논쟁이 겹침" };
  }
  if (signal === "ISSUE") {
    return { summary: clipText(last || "방송 상태 문의가 반복된다", SUMMARY_LIMIT), reason: "방송 상태 문의" };
  }
  if (signal === "QUESTION") {
    return { summary: clipText(last || "같은 질문이 반복된다", SUMMARY_LIMIT), reason: "공통 질문" };
  }
  return {
    summary: clipText(last || "채팅 수가 갑자기 늘었다", SUMMARY_LIMIT),
    reason: clipText(last ? `${last} 타이밍에 채팅 급증` : "채팅 화력 급증", REASON_LIMIT),
  };
}

function fallbackDonation(input: DonationDraftInput): string {
  const message = input.message.trim();
  if (message.length > 0 && !mentionsLoyalty(message)) {
    return clipText(message, SUMMARY_LIMIT);
  }
  return clipText(`${formatAmount(input.cheeseAmount)}치즈 후원`, SUMMARY_LIMIT);
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

/** 레이더 조건이 맞을 때만 부른다. 화력이면 마커 이유도 함께 만든다. */
export async function summarizeRadar(signal: RadarSignal, messages: string[]): Promise<RadarDraft> {
  const fallback = fallbackRadar(signal, messages);
  const label =
    signal === "SPIKE"
      ? "채팅 화력 급증"
      : signal === "ISSUE"
        ? "방송 상태 문의"
        : signal === "QUESTION"
          ? "공통 질문"
          : "훈수와 논쟁";
  const raw = await askModel(
    `[감지]\n${label}\n\n최근 60초 채팅:\n${chatBlock(messages)}`,
    radarConfig,
  );
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallback;
    }
    const summary = acceptLine(parsed.summary, SUMMARY_LIMIT);
    const reason = acceptLine(parsed.reason, REASON_LIMIT);
    return {
      summary: summary ?? fallback.summary,
      reason: reason ?? fallback.reason,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 레이더 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}

/** 이번 후원 메시지와 직전 채팅의 연결만 35자로 줄인다. */
export async function summarizeDonation(input: DonationDraftInput): Promise<string> {
  const fallback = fallbackDonation(input);
  const who = input.anonymous ? "익명" : input.nickname;
  const raw = await askModel(
    `[이번 후원]
닉네임: ${who}
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${input.message || "(메시지 없음)"}
${input.cheeseAmount >= HIGH_CHEESE ? "고액 후원이다. 누적이나 단골은 말하지 마라." : ""}

직전 채팅:
${chatBlock(input.recentChats)}`,
    donationConfig,
  );
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return fallback;
    }
    return acceptLine(parsed.summary, SUMMARY_LIMIT) ?? fallback;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pd] 후원 JSON 해석에 실패했습니다. ${message}`);
    return fallback;
  }
}
