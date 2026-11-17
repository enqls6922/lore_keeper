import { connection } from "next/server";
import type { Prisma } from "@prisma/client";

import type { BriefingCard, BriefingTriggerType } from "@/lib/briefing-card";
import { prisma } from "@/lib/prisma";

const LATEST_LIMIT = 20;

const briefingInclude = {
  viewer: {
    select: {
      nickname: true,
      totalCheese: true,
      visitCount: true,
    },
  },
} satisfies Prisma.BriefingInclude;

type BriefingWithViewer = Prisma.BriefingGetPayload<{
  include: typeof briefingInclude;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readReplies(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readTriggerType(value: string): BriefingTriggerType {
  if (value === "CHEESE" || value === "NEW_VIEWER" || value === "RETURNING") {
    return value;
  }
  return "RETURNING";
}

function toCard(row: BriefingWithViewer): BriefingCard {
  return {
    id: row.id,
    triggerType: readTriggerType(row.triggerType),
    triggerMessage: row.triggerMessage,
    cheeseAmount: row.cheeseAmount,
    summarySnapshot: row.summarySnapshot,
    suggestedReplies: readReplies(row.suggestedReplies),
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
    viewer: {
      nickname: row.viewer.nickname,
      totalCheese: row.viewer.totalCheese,
      visitCount: row.viewer.visitCount,
    },
  };
}

/**
 * 최신 20장. 고정된 카드가 항상 위이고, 같은 그룹 안에서는 최근 생성순이다.
 * 폴링이 빌드 시점 스냅샷을 받지 않도록 요청이 들어온 뒤에 조회한다.
 */
export async function GET(): Promise<Response> {
  await connection();

  try {
    const rows = await prisma.briefing.findMany({
      include: briefingInclude,
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: LATEST_LIMIT,
    });

    return Response.json(rows.map(toCard), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "브리핑을 불러오지 못했습니다.";
    console.error(`[GET /api/briefings] ${message}`);
    return Response.json(
      { message: "브리핑을 불러오지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** 카드 id를 받아 고정 여부를 뒤집는다. */
export async function PATCH(request: Request): Promise<Response> {
  await connection();

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.id !== "string" || body.id.trim().length === 0) {
      return Response.json({ message: "브리핑 id가 필요합니다." }, { status: 400 });
    }

    const id = body.id.trim();
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.briefing.findUnique({
        where: { id },
        include: briefingInclude,
      });
      if (!current) {
        return null;
      }
      return tx.briefing.update({
        where: { id },
        data: { isPinned: !current.isPinned },
        include: briefingInclude,
      });
    });

    if (!updated) {
      return Response.json({ message: "브리핑을 찾지 못했습니다." }, { status: 404 });
    }

    return Response.json(toCard(updated), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "고정을 바꾸지 못했습니다.";
    console.error(`[PATCH /api/briefings] ${message}`);
    return Response.json({ message: "고정을 바꾸지 못했습니다." }, { status: 500 });
  }
}
