import { connection } from "next/server";

import { briefingInclude, toBriefingCard } from "@/lib/briefing-mapper";
import type { BriefingCard, BriefingTriggerType } from "@/lib/briefing-card";
import { generateBriefing } from "@/lib/llm/briefing";
import { prisma } from "@/lib/prisma";

const MAX_RECENT_CHATS = 15;
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ChatEventInput {
  userIdHash: string;
  nickname: string;
  message: string;
  cheeseAmount: number;
}

export interface ChatEventResponse {
  triggerType: BriefingTriggerType | null;
  briefing: BriefingCard | null;
  viewer: {
    nickname: string;
    totalCheese: number;
    visitCount: number;
  };
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

function readEventInput(value: unknown): ChatEventInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const userIdHash = readBounded(value.userIdHash, 128);
  const nickname = readBounded(value.nickname, 40);
  if (!userIdHash || !nickname || typeof value.message !== "string" || value.message.length > 500) {
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
  };
}

/** 시청자 채팅·후원을 저장하고, 후원이거나 첫 방문일 때만 브리핑을 만든다. */
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

    const now = new Date();
    const previous = await prisma.viewer.findUnique({
      where: { userIdHash: input.userIdHash },
      select: { id: true },
    });
    const isNew = previous === null;

    const viewer = await prisma.viewer.upsert({
      where: { userIdHash: input.userIdHash },
      create: {
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

    await prisma.chatLog.create({
      data: {
        viewerId: viewer.id,
        message: input.message,
        cheeseAmount: input.cheeseAmount,
        createdAt: now,
      },
    });

    let triggerType: BriefingTriggerType | null = null;
    if (input.cheeseAmount > 0) {
      triggerType = "CHEESE";
    } else if (isNew) {
      triggerType = "NEW_VIEWER";
    }

    if (!triggerType) {
      const body: ChatEventResponse = {
        triggerType: null,
        briefing: null,
        viewer: {
          nickname: viewer.nickname,
          totalCheese: viewer.totalCheese,
          visitCount: viewer.visitCount,
        },
      };
      return Response.json(body, { headers: NO_STORE });
    }

    const recentChats = await prisma.chatLog.findMany({
      where: { viewerId: viewer.id },
      orderBy: { createdAt: "desc" },
      take: MAX_RECENT_CHATS,
      select: {
        message: true,
        cheeseAmount: true,
        createdAt: true,
      },
    });

    const briefing = await generateBriefing({
      viewer,
      recentChats,
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
