import type { ShortIdea } from "@/lib/llm/packaging";

export interface StreamReportCard {
  id: string;
  sessionDate: string;
  youtubeChapters: string;
  shortsIdeas: ShortIdea[];
  fanCafeDigest: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isShortIdea(value: unknown): value is ShortIdea {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timestamp === "string" &&
    /^\d{2}:\d{2}:\d{2}$/.test(value.timestamp) &&
    typeof value.title === "string" &&
    typeof value.thumbnailCopy === "string" &&
    typeof value.reason === "string"
  );
}

export function isStreamReportCard(value: unknown): value is StreamReportCard {
  if (!isRecord(value) || !Array.isArray(value.shortsIdeas) || !value.shortsIdeas.every(isShortIdea)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.sessionDate === "string" &&
    typeof value.youtubeChapters === "string" &&
    typeof value.fanCafeDigest === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isStreamReportList(value: unknown): value is StreamReportCard[] {
  return Array.isArray(value) && value.every(isStreamReportCard);
}

export function toReportCard(row: {
  id: string;
  sessionDate: string;
  youtubeChapters: string;
  shortsIdeas: unknown;
  fanCafeDigest: string;
  createdAt: Date;
}): StreamReportCard | null {
  if (!Array.isArray(row.shortsIdeas) || !row.shortsIdeas.every(isShortIdea)) {
    return null;
  }
  return {
    id: row.id,
    sessionDate: row.sessionDate,
    youtubeChapters: row.youtubeChapters,
    shortsIdeas: row.shortsIdeas,
    fanCafeDigest: row.fanCafeDigest,
    createdAt: row.createdAt.toISOString(),
  };
}
