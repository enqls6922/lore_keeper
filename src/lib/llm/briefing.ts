import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
} from "@google/generative-ai";
import type { Briefing, Viewer } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** 브리핑을 만든 계기. 스키마의 triggerType 과 동일한 값만 허용한다. */
export type BriefingTriggerType = "CHEESE" | "NEW_VIEWER" | "RETURNING";

export interface BriefingRecentChat {
  message: string;
  cheeseAmount?: number;
  createdAt?: Date;
}

export interface GenerateBriefingInput {
  viewer: Viewer;
  /** 최근 채팅. 15개를 넘기면 마지막 15개만 사용한다. 시각이 있으면 오래된 순으로 정렬한다. */
  recentChats: BriefingRecentChat[];
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

function readApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

function formatFact(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** 모델이 없을 때도 사실 데이터에 있는 숫자만 써서 카드를 만든다. */
function buildFactualDraft(input: GenerateBriefingInput): BriefingDraft {
  const nickname = input.viewer.nickname;
  const cheeseAmount = formatFact(input.cheeseAmount);
  const totalCheese = formatFact(input.viewer.totalCheese);
  const visitCount = formatFact(input.viewer.visitCount);

  if (input.triggerType === "CHEESE") {
    return {
      summary: `${nickname}님이 치즈 ${cheeseAmount}개를 보냈습니다. 누적 ${totalCheese}개, 방문 ${visitCount}회.`,
      suggestedReplies: [
        `${nickname} 치즈 ${cheeseAmount}개 고마워`,
        `누적 ${totalCheese}개, 방문 ${visitCount}회째네`,
      ],
    };
  }

  if (input.triggerType === "NEW_VIEWER") {
    return {
      summary: `${nickname}님이 처음 채팅을 남겼습니다. 방문 ${visitCount}회.`,
      suggestedReplies: [`${nickname} 첫 방문 환영해`, `방문 ${visitCount}회, 오늘 처음이구나`],
    };
  }

  return {
    summary: `${nickname}님이 다시 찾았습니다. 누적 치즈 ${totalCheese}개, 방문 ${visitCount}회.`,
    suggestedReplies: [`${nickname} 또 와 줘서 반가워`, `누적 ${totalCheese}개, 방문 ${visitCount}회째네`],
  };
}

async function saveBriefing(input: GenerateBriefingInput, draft: BriefingDraft): Promise<Briefing> {
  return prisma.$transaction(async (tx) => {
    const briefing = await tx.briefing.create({
      data: {
        userId: input.viewer.userId,
        viewerId: input.viewer.id,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        cheeseAmount: input.cheeseAmount,
        summarySnapshot: draft.summary,
        suggestedReplies: draft.suggestedReplies,
      },
    });
    await tx.viewer.update({
      where: { id: input.viewer.id },
      data: { aiSummary: draft.summary },
    });
    return briefing;
  });
}

function formatChatLine(chat: BriefingRecentChat): string {
  const time =
    chat.createdAt instanceof Date ? `[${chat.createdAt.toLocaleString("ko-KR", { hour12: false })}] ` : "";
  const cheese = chat.cheeseAmount !== undefined && chat.cheeseAmount > 0 ? ` (치즈 ${chat.cheeseAmount})` : "";
  return `- ${time}${chat.message}${cheese}`;
}

function orderedRecentChats(chats: BriefingRecentChat[]): BriefingRecentChat[] {
  const copy = [...chats];
  if (copy.length > 0 && copy.every((chat) => chat.createdAt instanceof Date)) {
    copy.sort((left, right) => {
      const leftTime = left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
      const rightTime = right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
      return leftTime - rightTime;
    });
  }
  return copy.slice(-MAX_RECENT_CHATS);
}

function buildUserPrompt(input: GenerateBriefingInput): string {
  const chats = orderedRecentChats(input.recentChats);

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
 * 키가 있으면 gemini-2.5-flash-lite JSON을 쓰고, 실패하면 사실 데이터만으로 저장한다.
 */
export async function generateBriefing(
  input: GenerateBriefingInput,
): Promise<Briefing | null> {
  const apiKey = readApiKey();
  if (apiKey) {
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig,
      });
      const result = await model.generateContent(buildUserPrompt(input));
      return await saveBriefing(input, parseDraft(result.response.text()));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[generateBriefing] 모델 호출에 실패해 사실 데이터로 저장합니다. ${message}`);
    }
  } else {
    console.error("[generateBriefing] GEMINI_API_KEY가 없어 사실 데이터로 브리핑을 만듭니다.");
  }

  try {
    return await saveBriefing(input, buildFactualDraft(input));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[generateBriefing] 브리핑 저장에 실패했습니다. ${message}`);
    return null;
  }
}
