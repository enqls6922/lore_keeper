import {
  DONATION_FADE_MS,
  HIGH_CHEESE,
  HIGH_DONATION_FADE_MS,
  RADAR_VISIBLE_MS,
  isBriefingCategory,
  isMarkerTrigger,
  type BriefingCategory,
  type MarkerTrigger,
} from "@/lib/chat-radar";

export type BriefingType = "DONATION" | "RADAR";

export interface BriefingCard {
  id: string;
  type: BriefingType;
  category: BriefingCategory | null;
  nickname: string | null;
  cheeseAmount: number | null;
  totalCheeseSnapshot: number | null;
  summary: string;
  isPinned: boolean;
  createdAt: string;
}

export interface HighlightMarkerCard {
  id: string;
  sessionDate: string;
  elapsedSec: number;
  formattedTime: string;
  triggerType: MarkerTrigger;
  summary: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isOptionalInt(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isBriefingCard(value: unknown): value is BriefingCard {
  if (!isRecord(value)) {
    return false;
  }
  const categoryOk = value.category === null || isBriefingCategory(value.category);
  return (
    typeof value.id === "string" &&
    (value.type === "DONATION" || value.type === "RADAR") &&
    categoryOk &&
    isOptionalString(value.nickname) &&
    isOptionalInt(value.cheeseAmount) &&
    isOptionalInt(value.totalCheeseSnapshot) &&
    typeof value.summary === "string" &&
    typeof value.isPinned === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export function isBriefingCardList(value: unknown): value is BriefingCard[] {
  return Array.isArray(value) && value.every(isBriefingCard);
}

export function isHighlightMarkerCard(value: unknown): value is HighlightMarkerCard {
  if (!isRecord(value) || !isMarkerTrigger(value.triggerType)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.sessionDate === "string" &&
    isInteger(value.elapsedSec) &&
    typeof value.formattedTime === "string" &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isHighlightMarkerList(value: unknown): value is HighlightMarkerCard[] {
  return Array.isArray(value) && value.every(isHighlightMarkerCard);
}

export function isRadarVisible(card: BriefingCard, nowMs: number): boolean {
  if (card.type !== "RADAR") {
    return false;
  }
  if (nowMs <= 0) {
    return true;
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
  const limit = (card.cheeseAmount ?? 0) >= HIGH_CHEESE ? HIGH_DONATION_FADE_MS : DONATION_FADE_MS;
  return nowMs - createdMs >= limit;
}

function donationRank(card: BriefingCard, nowMs: number): number {
  if (card.isPinned) {
    return 0;
  }
  return isDonationFaded(card, nowMs) ? 2 : 1;
}

/** 고정이 위, 선명한 후원이 다음, 시간이 지난 후원은 아래다. */
export function compareDonations(left: BriefingCard, right: BriefingCard, nowMs: number): number {
  const rank = donationRank(left, nowMs) - donationRank(right, nowMs);
  if (rank !== 0) {
    return rank;
  }
  return right.createdAt.localeCompare(left.createdAt);
}

export function radarBanner(category: BriefingCategory | null): { icon: string; title: string } {
  if (category === "ISSUE") {
    return { icon: "⚠️", title: "방송 이슈" };
  }
  if (category === "QUESTION") {
    return { icon: "💬", title: "채팅방 공통 질문" };
  }
  return { icon: "🔥", title: "분위기 / 훈수" };
}

/** 1분 미만은 방금 전이다. */
export function formatElapsed(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  const delta = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
  const minute = 60_000;
  if (delta < minute) {
    return "방금 전";
  }
  const minutes = Math.floor(delta / minute);
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  return `${Math.floor(hours / 24)}일 전`;
}

/** 익명은 비우고, 이번 금액과 누적이 같으면 첫 후원만 적는다. */
export function cumulativeLabel(card: BriefingCard): string | null {
  if (card.type !== "DONATION" || card.totalCheeseSnapshot === null) {
    return null;
  }
  if (card.cheeseAmount !== null && card.totalCheeseSnapshot === card.cheeseAmount) {
    return "첫 후원";
  }
  return `누적 ${card.totalCheeseSnapshot.toLocaleString("ko-KR")}치즈`;
}
