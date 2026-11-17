import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { briefingInclude, toBriefingCard } from "@/lib/briefing-mapper";
import type { BriefingCard, BriefingTriggerType } from "@/lib/briefing-card";
import { generateBriefing } from "@/lib/llm/briefing";
import { prisma } from "@/lib/prisma";

const MAX_RECENT_CHATS = 15;
const MAX_CHAT_LENGTH = 500;
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ChatEventInput {
  userIdHash: string;
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats: string[];
  forceBriefing: boolean;
}

export interface ChatEventResponse {
  triggerType: BriefingTriggerType | null;
  briefing: BriefingCard | null;
  viewer: {
    nickname: string;
    totalCheese: number;
    visitCount: number;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBounded(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function resolveTriggerType(cheeseAmount: number, isNew: boolean): BriefingTriggerType {
  if (cheeseAmount > 0) {
    return "CHEESE";
  }
  if (isNew) {
    return "NEW_VIEWER";
  }
  return "RETURNING";
}

function readRecentChats(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const chats: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LENGTH) {
      continue;
    }
    chats.push(trimmed);
    if (chats.length >= MAX_RECENT_CHATS) {
      break;
    }
  }
  return chats;
}

function readEventInput(value: unknown): ChatEventInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const userIdHash = readBounded(value.userIdHash, 128);
  const nickname = readBounded(value.nickname, 40);
  if (!userIdHash || !nickname || typeof value.message !== "string" || value.message.length > MAX_CHAT_LENGTH) {
    return null;
  }
  if (
    typeof value.cheeseAmount !== "number" ||
    !Number.isInteger(value.cheeseAmount) ||
    value.cheeseAmount < 0 ||
    value.cheeseAmount > 1_000_000_000
  ) {
    return null;
  }
  return {
    userIdHash,
    nickname,
    message: value.message.trim(),
    cheeseAmount: value.cheeseAmount,
    recentChats: readRecentChats(value.recentChats),
    forceBriefing: value.forceBriefing === true,
  };
}

/** 치즈 후원이나 강제 브리핑만 저장한다. 일반 채팅은 브라우저에 있으므로 DB에 쓰지 않는다. */
export async function POST(request: Request): Promise<Response> {
  await connection();

  try {
    const input = readEventInput(await request.json());
    if (!input) {
      return Response.json(
        { message: "userIdHash, nickname, message, cheeseAmount가 필요합니다." },
        { status: 400, headers: NO_STORE },
      );
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    if (input.cheeseAmount <= 0 && !input.forceBriefing) {
      const skipped: ChatEventResponse = { triggerType: null, briefing: null, viewer: null };
      return Response.json(skipped, { headers: NO_STORE });
    }

    const now = new Date();
    const viewerKey = { userId: user.id, userIdHash: input.userIdHash };
    const previous = await prisma.viewer.findUnique({
      where: { userId_userIdHash: viewerKey },
      select: { id: true },
    });
    const isNew = previous === null;

    const viewer = await prisma.viewer.upsert({
      where: { userId_userIdHash: viewerKey },
      create: {
        userId: user.id,
        userIdHash: input.userIdHash,
        nickname: input.nickname,
        totalCheese: input.cheeseAmount,
        visitCount: 1,
        lastSeenAt: now,
      },
      update: {
        nickname: input.nickname,
        totalCheese: { increment: input.cheeseAmount },
        visitCount: { increment: 1 },
        lastSeenAt: now,
      },
    });

    const triggerType: BriefingTriggerType = resolveTriggerType(input.cheeseAmount, isNew);

    const briefing = await generateBriefing({
      viewer,
      recentChats: input.recentChats.map((message) => ({ message })),
      triggerType,
      triggerMessage: input.message,
      cheeseAmount: input.cheeseAmount,
    });

    const card = briefing
      ? toBriefingCard(
          await prisma.briefing.findUniqueOrThrow({
            where: { id: briefing.id },
            include: briefingInclude,
          }),
        )
      : null;

    const freshViewer = card
      ? card.viewer
      : {
          nickname: viewer.nickname,
          totalCheese: viewer.totalCheese,
          visitCount: viewer.visitCount,
        };

    const body: ChatEventResponse = {
      triggerType,
      briefing: card,
      viewer: freshViewer,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "이벤트를 저장하지 못했습니다.";
    console.error(`[POST /api/events] ${message}`);
    return Response.json({ message: "이벤트를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
