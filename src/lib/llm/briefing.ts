import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerationConfig,
} from "@google/generative-ai";
import type { Briefing } from "@prisma/client";

import { ANONYMOUS_NICKNAME } from "@/lib/anonymous";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_SPEECH_LEVEL,
  isSpeechLevel,
  isToneTag,
  type SpeechLevel,
  type ToneTag,
} from "@/lib/stream-settings";

/** 브리핑을 만든 계기. 스키마의 triggerType 과 동일한 값만 허용한다. */
export type BriefingTriggerType = "CHEESE" | "NEW_VIEWER" | "RETURNING";

export interface BriefingRecentChat {
  message: string;
  cheeseAmount?: number;
  createdAt?: Date;
}

/** 브리핑의 대상. 익명이면 viewerId 가 없고 누적 기록도 없다. */
export interface BriefingPerson {
  userId: string;
  viewerId: string | null;
  nickname: string;
  totalCheese: number;
  visitCount: number;
  aiSummary: string | null;
  isAnonymous: boolean;
}

export interface GenerateBriefingInput {
  person: BriefingPerson;
  /** 최근 채팅. 15개를 넘기면 마지막 15개만 사용한다. 시각이 있으면 오래된 순으로 정렬한다. */
  recentChats: BriefingRecentChat[];
  triggerType: BriefingTriggerType;
  triggerMessage: string;
  cheeseAmount: number;
  streamSpeechLevel: string;
  streamToneTags: string[];
  streamHabit: string | null;
  streamContext: string | null;
}

interface BriefingDraft {
  summary: string;
  suggestedReplies: [string, string];
}

const MODEL_NAME = "gemini-2.5-flash-lite";
const MAX_RECENT_CHATS = 15;

const SUMMARY_LIMIT = 30;

const SYSTEM_PROMPT = `너는 한국어 버튜버·인터넷 방송 전문 방송 작가야.
스트리머가 생방송 중에 화면을 힐끗 보고 바로 읽을 수 있는 브리핑을 작성한다.

반드시 지킬 규칙:
- summary는 공백 포함 30자 이내의 개조식이다. 문장은 "~함" 또는 "~임"으로 끝낸다.
- 누적 치즈액, 이번 후원액, 방문 횟수처럼 숫자로 된 사실은 사용자가 넘긴 [사실 데이터]에 적힌 값만 쓴다. 데이터에 없는 숫자, 금액, 횟수는 절대 만들지 않는다.
- 이전 요약 문장과 사실 데이터의 숫자가 다르면 사실 데이터의 숫자를 따른다.
- 방송 컨셉 메모와 말투 디테일은 어미, 호칭, 금지에만 반영한다. 메모에 없는 사건이나 숫자를 사실처럼 쓰지 않는다.
- suggestedReplies는 스트리머가 마이크에 대고 바로 받아칠 구어체 멘트 정확히 2개다. [기본 어미]로 끝내고, [스타일 태그]의 성격을 두 멘트에 자연스럽게 섞는다. 태그 이름은 그대로 읽지 않는다.
- 익명 후원이면 누적 치즈, 방문 횟수, 단골 여부를 절대 말하지 않는다. 이번 치즈만 말하고, 추천 멘트는 "익명님 1,000치즈 감사합니다!"처럼 이번 후원만 자연스럽게 말한다.
- 마크다운, 코드 블록, 머리말, 부연 설명은 넣지 않는다.`;

const generationConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      summary: {
        type: SchemaType.STRING,
        description: "공백 포함 30자 이내 개조식 요약. ~함 또는 ~임으로 끝낸다",
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

function charCount(text: string): number {
  return Array.from(text).length;
}

/** 개조식 한 줄. 30자를 넘기면 뒤의 누적 정보는 뺀다. */
function joinFacts(lead: string, detail: string): string {
  const combined = `${lead}, ${detail}`;
  if (charCount(combined) <= SUMMARY_LIMIT) {
    return combined;
  }
  if (charCount(lead) <= SUMMARY_LIMIT) {
    return lead;
  }
  return Array.from(lead).slice(0, SUMMARY_LIMIT).join("");
}

function speechLevelOf(value: string): SpeechLevel {
  return isSpeechLevel(value) ? value : DEFAULT_SPEECH_LEVEL;
}

function toneTagsOf(values: string[]): ToneTag[] {
  return values.filter(isToneTag);
}

function speak(level: SpeechLevel, casual: string, polite: string, mixed: string): string {
  if (level === "정중한 존댓말") {
    return polite;
  }
  if (level === "반존대") {
    return mixed;
  }
  return casual;
}

const TAG_FLAVOR: Record<ToneTag, { casual: string; polite: string; mixed: string }> = {
  "텐션 높음": { casual: "진짜 대박이야", polite: "정말 놀랍습니다", mixed: "진짜 대박이에요" },
  "시크·무심": { casual: "담백하게 받았어", polite: "담백하게 받았습니다", mixed: "담백하게 받았어요" },
  "장난기·티키타카": { casual: "장난 아니야", polite: "장난이 아닙니다", mixed: "장난 아니에요" },
  "다정·감사": { casual: "마음이 따뜻해", polite: "마음이 따뜻합니다", mixed: "마음이 따뜻해요" },
  "겜방·드립": { casual: "캐리 고마워", polite: "캐리에 감사합니다", mixed: "캐리 고마워요" },
};

/** 고른 태그 성격을 같은 어미로 한 줄에 섞는다. 태그가 없으면 짧은 인사만 한다. */
function blendTags(level: SpeechLevel, tags: readonly ToneTag[]): string {
  const bits = tags
    .slice(0, 2)
    .map((tag) => speak(level, TAG_FLAVOR[tag].casual, TAG_FLAVOR[tag].polite, TAG_FLAVOR[tag].mixed));
  if (bits.length === 0) {
    return speak(level, "오늘도 반가워", "오늘도 반갑습니다", "오늘도 반가워요");
  }
  return bits.join(" ");
}

function speechRule(level: SpeechLevel): string {
  if (level === "정중한 존댓말") {
    return "문장 끝은 ~습니다, ~세요처럼 정중한 존댓말로 한다. 반말은 쓰지 않는다.";
  }
  if (level === "반존대") {
    return "문장 끝은 친근한 ~요로 한다. 딱딱한 ~습니다와 짧은 반말은 쓰지 않는다.";
  }
  return "문장 끝은 친근한 반말로 한다. ~요, ~습니다는 쓰지 않는다.";
}

function voiceBlock(input: GenerateBriefingInput): string {
  const level = speechLevelOf(input.streamSpeechLevel);
  const tags = toneTagsOf(input.streamToneTags);
  const habit = input.streamHabit?.trim() || "없음";
  const context = input.streamContext?.trim() || "없음";
  return `[기본 어미]
${level}
${speechRule(level)}

[스타일 태그]
${tags.length > 0 ? tags.join(", ") : "없음"}
선택된 태그의 성격을 추천 멘트 2개에 자연스럽게 섞는다. 태그 이름을 멘트에 넣지 않는다.

[말투 디테일]
${habit}
이 메모는 입버릇과 피할 말투만 반영한다. 메모의 문장을 사건이나 사실처럼 쓰지 않는다.

[방송 컨셉 메모]
${context}`;
}

function spokenPair(level: SpeechLevel, tags: readonly ToneTag[], first: { casual: string; polite: string; mixed: string }): [string, string] {
  return [speak(level, first.casual, first.polite, first.mixed), blendTags(level, tags)];
}

/** 모델이 없을 때도 사실 데이터에 있는 숫자만 써서 30자 개조식으로 만든다. */
function buildFactualDraft(input: GenerateBriefingInput): BriefingDraft {
  const cheeseAmount = formatFact(input.cheeseAmount);
  const level = speechLevelOf(input.streamSpeechLevel);
  const tags = toneTagsOf(input.streamToneTags);
  if (input.person.isAnonymous) {
    return {
      summary: `${cheeseAmount}치즈 익명 후원임`,
      suggestedReplies: spokenPair(level, tags, {
        casual: `익명님 ${cheeseAmount}치즈 고마워`,
        polite: `익명님 ${cheeseAmount}치즈 감사합니다`,
        mixed: `익명님 ${cheeseAmount}치즈 고마워요`,
      }),
    };
  }

  const nickname = input.person.nickname;
  const totalCheese = formatFact(input.person.totalCheese);
  const visitCount = formatFact(input.person.visitCount);

  if (input.triggerType === "CHEESE") {
    return {
      summary: joinFacts(`${cheeseAmount}치즈 후원함`, `누적 ${totalCheese}임`),
      suggestedReplies: spokenPair(level, tags, {
        casual: `${nickname} 치즈 ${cheeseAmount}개 고마워`,
        polite: `${nickname} 님, 치즈 ${cheeseAmount}개 감사합니다`,
        mixed: `${nickname} 님 치즈 ${cheeseAmount}개 고마워요`,
      }),
    };
  }

  if (input.triggerType === "NEW_VIEWER") {
    return {
      summary: joinFacts("첫 채팅임", `방문 ${visitCount}회임`),
      suggestedReplies: spokenPair(level, tags, {
        casual: `${nickname} 첫 방문 환영해`,
        polite: `${nickname} 님, 첫 방문 환영합니다`,
        mixed: `${nickname} 님 첫 방문 환영해요`,
      }),
    };
  }

  return {
    summary: joinFacts("다시 방문함", `누적 ${totalCheese}임`),
    suggestedReplies: spokenPair(level, tags, {
      casual: `${nickname} 또 와 줘서 고마워`,
      polite: `${nickname} 님, 다시 와 주셔서 감사합니다`,
      mixed: `${nickname} 님 또 와 줘서 고마워요`,
    }),
  };
}

async function saveBriefing(input: GenerateBriefingInput, draft: BriefingDraft): Promise<Briefing> {
  return prisma.$transaction(async (tx) => {
    const briefing = await tx.briefing.create({
      data: {
        userId: input.person.userId,
        viewerId: input.person.viewerId,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        cheeseAmount: input.cheeseAmount,
        summarySnapshot: draft.summary,
        suggestedReplies: draft.suggestedReplies,
      },
    });
    if (input.person.viewerId) {
      await tx.viewer.update({
        where: { id: input.person.viewerId },
        data: { aiSummary: draft.summary },
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

  const chatBlock =
    chats.length > 0 ? chats.map(formatChatLine).join("\n") : "- (최근 채팅 없음)";

  const voice = voiceBlock(input);
  if (input.person.isAnonymous) {
    return `${voice}

[익명 후원]
이 후원자는 익명이다. 누적 치즈, 방문 횟수, 단골 여부는 말하지 마라.
표시 이름: ${ANONYMOUS_NICKNAME}
이번 치즈: ${input.cheeseAmount}
이번 메시지: ${input.triggerMessage}

추천 멘트는 "익명님 ${formatFact(input.cheeseAmount)}치즈 감사합니다!"처럼 이번 금액만 자연스럽게 말한다. 기본 어미와 스타일 태그를 함께 지킨다.`;
  }

  const previousSummary = input.person.aiSummary?.trim() || "없음";

  return `${voice}

[사실 데이터]
닉네임: ${input.person.nickname}
누적 치즈: ${input.person.totalCheese}
방문 횟수: ${input.person.visitCount}
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

function mentionsHistory(draft: BriefingDraft): boolean {
  const text = `${draft.summary} ${draft.suggestedReplies.join(" ")}`;
  return text.includes("누적") || text.includes("방문") || text.includes("단골");
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
  if (charCount(summary.trim()) > SUMMARY_LIMIT) {
    throw new Error("LLM 응답의 summary가 30자를 넘습니다.");
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
      const draft = parseDraft(result.response.text());
      if (input.person.isAnonymous && mentionsHistory(draft)) {
        throw new Error("익명 브리핑에 누적 기록이 들어 있습니다.");
      }
      return await saveBriefing(input, draft);
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
