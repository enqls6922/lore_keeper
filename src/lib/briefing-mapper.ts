import type { Briefing, HighlightMarker } from "@prisma/client";

import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { stripChzzkEmotes } from "@/lib/chzzk/text";
import { isBriefingCategory, isMarkerTrigger } from "@/lib/chat-radar";

export function toBriefingCard(row: Briefing): BriefingCard {
  return {
    id: row.id,
    type: row.type === "RADAR" ? "RADAR" : "DONATION",
    category: isBriefingCategory(row.category) ? row.category : null,
    nickname: row.nickname,
    cheeseAmount: row.cheeseAmount,
    totalCheeseSnapshot: row.totalCheeseSnapshot,
    summary: stripChzzkEmotes(row.summary),
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMarkerCard(row: HighlightMarker): HighlightMarkerCard {
  return {
    id: row.id,
    sessionDate: row.sessionDate,
    elapsedSec: row.elapsedSec,
    formattedTime: row.formattedTime,
    triggerType: isMarkerTrigger(row.triggerType) ? row.triggerType : "CHAT_SPIKE",
    summary: stripChzzkEmotes(row.summary),
    createdAt: row.createdAt.toISOString(),
  };
}
