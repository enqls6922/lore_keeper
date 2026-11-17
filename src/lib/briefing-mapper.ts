import type { Prisma } from "@prisma/client";

import type { BriefingCard, BriefingTriggerType } from "@/lib/briefing-card";

export const briefingInclude = {
  viewer: {
    select: {
      nickname: true,
      totalCheese: true,
      visitCount: true,
    },
  },
} satisfies Prisma.BriefingInclude;

export type BriefingWithViewer = Prisma.BriefingGetPayload<{
  include: typeof briefingInclude;
}>;

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

/** DB 행을 카드로 바꾼다. 누적 치즈와 방문 수는 저장된 시청자 값이다. */
export function toBriefingCard(row: BriefingWithViewer): BriefingCard {
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
