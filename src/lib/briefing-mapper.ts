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

function readTriggerType(value: string): BriefingTriggerType {
  if (value === "CHEESE" || value === "NEW_VIEWER" || value === "RETURNING") {
    return value;
  }
  return "CHEESE";
}

/** DB 행을 상황 카드로 바꾼다. 익명 사연은 익명 후원으로 고정한다. */
export function toBriefingCard(row: BriefingWithViewer): BriefingCard {
  const anonymous = row.viewerId === null || row.viewer === null;
  return {
    id: row.id,
    triggerType: readTriggerType(row.triggerType),
    triggerMessage: row.triggerMessage,
    cheeseAmount: row.cheeseAmount,
    viewerStory: anonymous ? "익명 후원" : (row.viewerStory ?? ""),
    contextSummary: row.contextSummary ?? "",
    isPinned: row.isPinned,
    isAnonymous: anonymous,
    createdAt: row.createdAt.toISOString(),
    viewer: anonymous || !row.viewer
      ? null
      : {
          nickname: row.viewer.nickname,
          totalCheese: row.viewer.totalCheese,
          visitCount: row.viewer.visitCount,
        },
  };
}
