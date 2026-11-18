import { DONATION_FADE_MS, RADAR_VISIBLE_MS, type RadarSignal } from "@/lib/chat-radar";

/** 대시보드와 API가 공유하는 카드. 시청자 누적 숫자는 담지 않는다. */
export type BriefingType = "DONATION" | "RADAR";

export interface BriefingCard {
  id: string;
  type: BriefingType;
  title: string;
  summary: string;
  signal: RadarSignal | null;
  isPinned: boolean;
  createdAt: string;
}

export interface HighlightMarkerCard {
  id: string;
  timestampSec: number;
  formattedTime: string;
  reason: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isSignal(value: unknown): value is RadarSignal | null {
  return value === null || value === "SPIKE" || value === "QUESTION" || value === "ISSUE" || value === "COACHING";
}

export function isBriefingCard(value: unknown): value is BriefingCard {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.type === "DONATION" || value.type === "RADAR") &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isSignal(value.signal) &&
    typeof value.isPinned === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export function isBriefingCardList(value: unknown): value is BriefingCard[] {
  return Array.isArray(value) && value.every(isBriefingCard);
}

export function isHighlightMarkerCard(value: unknown): value is HighlightMarkerCard {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    isInteger(value.timestampSec) &&
    typeof value.formattedTime === "string" &&
    typeof value.reason === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isHighlightMarkerList(value: unknown): value is HighlightMarkerCard[] {
  return Array.isArray(value) && value.every(isHighlightMarkerCard);
}

export function isRadarVisible(card: BriefingCard, nowMs: number): boolean {
  if (card.type !== "RADAR" || nowMs <= 0) {
    return card.type === "RADAR";
  }
  const createdMs = Date.parse(card.createdAt);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return nowMs - createdMs < RADAR_VISIBLE_MS;
}

export function isDonationFaded(card: BriefingCard, nowMs: number): boolean {
  if (card.type !== "DONATION" || card.isPinned || nowMs <= 0) {
    return false;
  }
  const createdMs = Date.parse(card.createdAt);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return nowMs - createdMs >= DONATION_FADE_MS;
}

function donationRank(card: BriefingCard, nowMs: number): number {
  if (card.isPinned) {
    return 0;
  }
  return isDonationFaded(card, nowMs) ? 2 : 1;
}

/** 고정이 위, 선명한 후원이 다음, 3분이 지난 후원은 아래다. */
export function compareDonations(left: BriefingCard, right: BriefingCard, nowMs: number): number {
  const rank = donationRank(left, nowMs) - donationRank(right, nowMs);
  if (rank !== 0) {
    return rank;
  }
  return right.createdAt.localeCompare(left.createdAt);
}

export function radarBannerLabel(signal: RadarSignal | null): { icon: string; title: string } {
  if (signal === "ISSUE") {
    return { icon: "⚠️", title: "방송 이슈" };
  }
  if (signal === "QUESTION") {
    return { icon: "💬", title: "채팅방 공통 질문" };
  }
  if (signal === "COACHING") {
    return { icon: "🔥", title: "훈수/논쟁 과열 감지 — 화제 전환 추천" };
  }
  return { icon: "🔥", title: "채팅 화력 폭발" };
}
