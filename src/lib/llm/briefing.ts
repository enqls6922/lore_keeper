import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
} from "@google/generative-ai";
import type { Briefing, ChatLog, Viewer } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** 브리핑을 만든 계기. 스키마의 triggerType 과 동일한 값만 허용한다. */
export type BriefingTriggerType = "CHEESE" | "NEW_VIEWER" | "RETURNING";

export interface GenerateBriefingInput {
  viewer: Viewer;
  /** 최근 채팅. 15개를 넘기면 시간순으로 마지막 15개만 사용한다. */
  recentChats: Pick<ChatLog, "message" | "cheeseAmount" | "createdAt">[];
  triggerType: BriefingTriggerType;
  triggerMessage: string;
  cheeseAmount: number;
}

interface BriefingDraft {
  summary: string;
  suggestedReplies: [string, string];
}

const MODEL_NAME = "gemini-2.5-flash-lite";
const MAX_RECENT_CHATS = 15;

const SYSTEM_PROMPT = `너는 한국어 버튜버·인터넷 방송 전문 방송 작가야.
스트리머가 생방송 중에 화면을 힐끗 보고 바로 읽을 수 있는 브리핑을 작성한다.

반드시 지킬 규칙:
- summary는 시청자 상황을 담은 한국어 한 줄이다.
- 누적 치즈액, 이번 후원액, 방문 횟수처럼 숫자로 된 사실은 사용자가 넘긴 [사실 데이터]에 적힌 값만 쓴다. 데이터에 없는 숫자, 금액, 횟수는 절대 만들지 않는다.
- 이전 요약 문장과 사실 데이터의 숫자가 다르면 사실 데이터의 숫자를 따른다.
- suggestedReplies는 스트리머가 마이크에 대고 바로 받아칠 수 있는 센스 있는 한국어 멘트 정확히 2개다.
- 마크다운, 코드 블록, 머리말, 부연 설명은 넣지 않는다.`;

const generationConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: {
        type: SchemaType.STRING,
        description: "사실 데이터만으로 만든 시청자 한 줄 요약",
      },
      suggestedReplies: {
        type: SchemaType.ARRAY,
        description: "스트리머가 바로 읽을 추천 멘트 2개",
        minItems: 2,
        maxItems: 2,
        items: {
          type: SchemaType.STRING,
        },
      },
    },
    required: ["summary", "suggestedReplies"],
  },
};

function readApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 환경변수가 비어 있습니다.");
  }
  return apiKey;
}

function formatChatLine(
  chat: Pick<ChatLog, "message" | "cheeseAmount" | "createdAt">,
): string {
  const time = chat.createdAt.toLocaleString("ko-KR", { hour12: false });
  if (chat.cheeseAmount > 0) {
    return `- [${time}] ${chat.message} (치즈 ${chat.cheeseAmount})`;
  }
  return `- [${time}] ${chat.message}`;
}

function buildUserPrompt(input: GenerateBriefingInput): string {
  const chats = [...input.recentChats]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(-MAX_RECENT_CHATS);

  const chatBlock =
    chats.length > 0 ? chats.map(formatChatLine).join("\n") : "- (최근 채팅 없음)";

  const previousSummary = input.viewer.aiSummary?.trim() || "없음";

  return `[사실 데이터]
닉네임: ${input.viewer.nickname}
누적 치즈: ${input.viewer.totalCheese}
방문 횟수: ${input.viewer.visitCount}
이전에 저장된 시청자 요약: ${previousSummary}
이번 트리거: ${input.triggerType}
이번 메시지: ${input.triggerMessage}
이번 치즈: ${input.cheeseAmount}

최근 채팅 로그 (최대 ${MAX_RECENT_CHATS}개, 오래된 순):
${chatBlock}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDraft(raw: string): BriefingDraft {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("LLM 응답이 JSON 객체가 아닙니다.");
  }

  const { summary, suggestedReplies } = parsed;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("LLM 응답의 summary가 비어 있습니다.");
  }
  if (!Array.isArray(suggestedReplies)) {
    throw new Error("LLM 응답의 suggestedReplies가 배열이 아닙니다.");
  }

  const replies = suggestedReplies.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (replies.length < 2) {
    throw new Error("추천 멘트가 2개 미만입니다.");
  }

  return {
    summary: summary.trim(),
    suggestedReplies: [replies[0].trim(), replies[1].trim()],
  };
}

/**
 * 시청자 사실과 이번 이벤트로 한 줄 요약·추천 멘트를 만들고 Briefing에 저장한다.
 * 모델 호출이 실패해도 호출한 워커가 죽지 않도록 null을 반환한다.
 */
export async function generateBriefing(
  input: GenerateBriefingInput,
): Promise<Briefing | null> {
  try {
    const model = new GoogleGenerativeAI(readApiKey()).getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig,
    });

    const result = await model.generateContent(buildUserPrompt(input));
    const draft = parseDraft(result.response.text());

    return await prisma.briefing.create({
      data: {
        viewerId: input.viewer.id,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        cheeseAmount: input.cheeseAmount,
        summarySnapshot: draft.summary,
        suggestedReplies: draft.suggestedReplies,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[generateBriefing] 브리핑 생성에 실패했습니다. ${message}`);
    return null;
  }
}
