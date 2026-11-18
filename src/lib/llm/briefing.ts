import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
} from "@google/generative-ai";
import type { Briefing } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type BriefingTriggerType = "CHEESE" | "NEW_VIEWER" | "RETURNING";

export interface BriefingRecentChat {
  message: string;
  cheeseAmount?: number;
  createdAt?: Date;
}

/** 브리핑의 대상. 익명이면 viewerId 가 없고 사연도 누적하지 않는다. */
export interface BriefingPerson {
  userId: string;
  viewerId: string | null;
  nickname: string;
  totalCheese: number;
  visitCount: number;
  storyMemo: string | null;
  isAnonymous: boolean;
}

export interface GenerateBriefingInput {
  person: BriefingPerson;
  /** 후원 직전 채팅. 20개를 넘기면 마지막 20개만 사용한다. */
  recentChats: BriefingRecentChat[];
  triggerType: BriefingTriggerType;
  triggerMessage: string;
  cheeseAmount: number;
}

interface SituationDraft {
  viewerStory: string;
  contextSummary: string;
}

const MODEL_NAME = "gemini-2.5-flash-lite";
const MAX_RECENT_CHATS = 20;
const STORY_LIMIT = 40;
const CONTEXT_LIMIT = 35;
const FIRST_DONOR_STORY = "신규 후원자";
const ANONYMOUS_STORY = "익명 후원";

const SYSTEM_PROMPT = `너는 한국어 인터넷 방송의 상황 기록 담당이다.
스트리머가 후원 직후 0.5초 안에 읽는 팩트만 적는다.

반드시 지킬 규칙:
- 추천 멘트, 대본, 리액션 대사, 존댓말 인사는 절대 쓰지 않는다.
- updatedViewerStory는 공백 포함 40자 이내의 시청자 프로필이다. 기존 사연에 이번 후원의 특이사항이 있으면 합쳐 압축한다. 특이사항이 없으면 기존 문장을 유지한다. 첫 후원이고 사연이 없으면 "신규 후원자"만 쓴다.
- contextSummary는 공백 포함 35자 이내의 개조식 한 줄이다. 후원 직전 채팅과 이번 메시지로 "왜 지금 후원했는지, 핵심이 무엇인지"만 짚는다.
- 누적 치즈, 이번 치즈, 방문 횟수는 [사실 데이터]에 적힌 값만 쓴다. 없는 숫자, 없는 사건, 없는 보스전이나 웃음을 만들지 않는다.
- 채팅과 이번 메시지에 없는 내용은 상황 요약에 넣지 않는다.
- 익명 후원이면 누적 치즈, 방문 횟수, 단골 여부를 말하지 않는다.
- 마크다운, 코드 블록, 머리말, 부연 설명은 넣지 않는다.`;

const generationConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      updatedViewerStory: {
        type: SchemaType.STRING,
        description: "공백 포함 40자 이내 시청자 사연. 첫 후원이고 사연이 없으면 신규 후원자",
      },
      contextSummary: {
        type: SchemaType.STRING,
        description: "공백 포함 35자 이내 후원 상황 한 줄",
      },
    },
    required: ["updatedViewerStory", "contextSummary"],
  },
};

function readApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

function formatFact(value: number): string {
  return value.toLocaleString("ko-KR");
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function clip(text: string, limit: number): string {
  return Array.from(text.trim()).slice(0, limit).join("");
}

function mentionsHistory(text: string): boolean {
  return text.includes("누적") || text.includes("방문") || text.includes("단골");
}

/** 모델이 없을 때 기존 사연을 유지하고, 첫 후원만 신규 후원자로 적는다. */
function fallbackStory(input: GenerateBriefingInput): string {
  if (input.person.isAnonymous) {
    return ANONYMOUS_STORY;
  }
  const existing = input.person.storyMemo?.trim() ?? "";
  if (existing.length > 0) {
    return clip(existing, STORY_LIMIT);
  }
  const message = input.triggerMessage.trim();
  if (message.length > 0) {
    return clip(message, STORY_LIMIT);
  }
  if (input.person.visitCount <= 1) {
    return FIRST_DONOR_STORY;
  }
  return clip(`방문 ${formatFact(input.person.visitCount)}회`, STORY_LIMIT);
}

/** 채팅에 없는 장면을 만들지 않고, 이번 메시지 또는 금액만 남긴다. */
function fallbackContext(input: GenerateBriefingInput): string {
  const message = input.triggerMessage.trim();
  if (message.length > 0 && !(input.person.isAnonymous && mentionsHistory(message))) {
    return clip(message, CONTEXT_LIMIT);
  }
  return clip(`${formatFact(input.cheeseAmount)}치즈 후원`, CONTEXT_LIMIT);
}

function buildFactualDraft(input: GenerateBriefingInput): SituationDraft {
  return {
    viewerStory: fallbackStory(input),
    contextSummary: fallbackContext(input),
  };
}

async function saveBriefing(input: GenerateBriefingInput, draft: SituationDraft): Promise<Briefing> {
  return prisma.$transaction(async (tx) => {
    const briefing = await tx.briefing.create({
      data: {
        userId: input.person.userId,
        viewerId: input.person.viewerId,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        cheeseAmount: input.cheeseAmount,
        viewerStory: draft.viewerStory,
        contextSummary: draft.contextSummary,
      },
    });
    if (input.person.viewerId) {
      await tx.viewer.update({
        where: { id: input.person.viewerId },
        data: { storyMemo: draft.viewerStory },
      });
    }
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
  const chatBlock = chats.length > 0 ? chats.map(formatChatLine).join("\n") : "- (직전 채팅 없음)";
  if (input.person.isAnonymous) {
    return `[익명 후원]
이 후원자는 익명이다. 누적 치즈, 방문 횟수, 단골 여부는 말하지 마라.
updatedViewerStory는 "익명 후원"으로만 써라.
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${input.triggerMessage}

후원 직전 채팅 (최대 ${MAX_RECENT_CHATS}개, 오래된 순):
${chatBlock}`;
  }

  const story = input.person.storyMemo?.trim() || "없음";
  return `[기존 시청자 사연]
${story}

[사실 데이터]
닉네임: ${input.person.nickname}
누적 치즈: ${input.person.totalCheese}
방문 횟수: ${input.person.visitCount}
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${input.triggerMessage}

후원 직전 채팅 (최대 ${MAX_RECENT_CHATS}개, 오래된 순):
${chatBlock}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDraft(raw: string, anonymous: boolean): SituationDraft {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("LLM 응답이 JSON 객체가 아닙니다.");
  }

  const story = parsed.updatedViewerStory;
  const context = parsed.contextSummary;
  if (typeof context !== "string" || context.trim().length === 0) {
    throw new Error("LLM 응답의 contextSummary가 비어 있습니다.");
  }
  if (charCount(context.trim()) > CONTEXT_LIMIT) {
    throw new Error("LLM 응답의 contextSummary가 35자를 넘습니다.");
  }
  if (anonymous && mentionsHistory(context)) {
    throw new Error("익명 상황에 누적 기록이 들어 있습니다.");
  }

  if (anonymous) {
    return { viewerStory: ANONYMOUS_STORY, contextSummary: context.trim() };
  }

  if (typeof story !== "string" || story.trim().length === 0) {
    throw new Error("LLM 응답의 updatedViewerStory가 비어 있습니다.");
  }
  if (charCount(story.trim()) > STORY_LIMIT) {
    throw new Error("LLM 응답의 updatedViewerStory가 40자를 넘습니다.");
  }
  return { viewerStory: story.trim(), contextSummary: context.trim() };
}

/**
 * 후원 사연과 직전 채팅으로 시청자 기억, 상황 한 줄을 만들고 Briefing에 저장한다.
 * 키가 있으면 gemini-2.5-flash-lite JSON을 쓰고, 실패하면 넘어온 사실만 저장한다.
 * 식별된 시청자면 storyMemo도 같은 기억으로 갱신한다.
 */
export async function generateBriefing(input: GenerateBriefingInput): Promise<Briefing | null> {
  const apiKey = readApiKey();
  if (apiKey) {
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig,
      });
      const result = await model.generateContent(buildUserPrompt(input));
      return await saveBriefing(input, parseDraft(result.response.text(), input.person.isAnonymous));
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
