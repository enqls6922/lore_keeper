import type { Briefing, HighlightMarker } from "@prisma/client";

import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { isRadarSignal } from "@/lib/chat-radar";

export function toBriefingCard(row: Briefing): BriefingCard {
  return {
    id: row.id,
    type: row.type === "RADAR" ? "RADAR" : "DONATION",
    title: row.title,
    summary: row.summary,
    signal: isRadarSignal(row.signal) ? row.signal : null,
    isPinned: row.isPinned,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMarkerCard(row: HighlightMarker): HighlightMarkerCard {
  return {
    id: row.id,
    timestampSec: row.timestampSec,
    formattedTime: row.formattedTime,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
