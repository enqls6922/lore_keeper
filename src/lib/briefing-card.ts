/** 대시보드와 API가 공유하는 상황 카드. 숫자는 DB에 저장된 값만 담는다. */
export type BriefingTriggerType = "CHEESE" | "NEW_VIEWER" | "RETURNING";

export interface BriefingViewerSnapshot {
  nickname: string;
  totalCheese: number;
  visitCount: number;
}

export interface BriefingCard {
  id: string;
  triggerType: BriefingTriggerType;
  triggerMessage: string;
  cheeseAmount: number;
  viewerStory: string;
  contextSummary: string;
  isPinned: boolean;
  isAnonymous: boolean;
  createdAt: string;
  viewer: BriefingViewerSnapshot | null;
}

const TRIGGER_TYPES: readonly BriefingTriggerType[] = ["CHEESE", "NEW_VIEWER", "RETURNING"];

/** 이 금액 이상이면 상황 카드를 더 오래 위에 둔다. */
export const HIGH_CHEESE = 10_000;
export const ACTIVE_CARD_MS = 3 * 60 * 1000;
export const HIGH_CHEESE_CARD_MS = 10 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isTriggerType(value: unknown): value is BriefingTriggerType {
  return typeof value === "string" && TRIGGER_TYPES.some((triggerType) => triggerType === value);
}

function isViewerSnapshot(value: unknown): value is BriefingViewerSnapshot | null {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.nickname === "string" && isInteger(value.totalCheese) && isInteger(value.visitCount);
}

export function isBriefingCard(value: unknown): value is BriefingCard {
  if (!isRecord(value) || !isViewerSnapshot(value.viewer)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    isTriggerType(value.triggerType) &&
    typeof value.triggerMessage === "string" &&
    isInteger(value.cheeseAmount) &&
    typeof value.viewerStory === "string" &&
    typeof value.contextSummary === "string" &&
    typeof value.isPinned === "boolean" &&
    typeof value.isAnonymous === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export function isBriefingCardList(value: unknown): value is BriefingCard[] {
  return Array.isArray(value) && value.every(isBriefingCard);
}

/** 고정 카드는 흐려지지 않는다. 고액 후원은 10분, 그 외는 3분이 지나면 내려간다. */
export function isCardFaded(card: BriefingCard, nowMs: number): boolean {
  if (card.isPinned) {
    return false;
  }
  const createdMs = Date.parse(card.createdAt);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  const limit = card.cheeseAmount >= HIGH_CHEESE ? HIGH_CHEESE_CARD_MS : ACTIVE_CARD_MS;
  return nowMs - createdMs >= limit;
}

function cardRank(card: BriefingCard, nowMs: number): number {
  if (card.isPinned) {
    return 0;
  }
  return isCardFaded(card, nowMs) ? 2 : 1;
}

/** 고정이 위, 그다음 아직 선명한 카드, 시간이 지난 카드는 맨 아래. */
export function compareLiveCards(left: BriefingCard, right: BriefingCard, nowMs: number): number {
  const rank = cardRank(left, nowMs) - cardRank(right, nowMs);
  if (rank !== 0) {
    return rank;
  }
  return right.createdAt.localeCompare(left.createdAt);
}

/** 누적 치즈를 화면 배지로 줄인다. 천 원 단위가 아니면 원 숫자를 그대로 쓴다. */
export function formatCumulativeCheese(amount: number): string {
  if (amount >= HIGH_CHEESE && amount % 1_000 === 0) {
    const man = amount / 10_000;
    const text = Number.isInteger(man) ? String(man) : man.toFixed(1);
    return `${text}만`;
  }
  return amount.toLocaleString("ko-KR");
}

/** 카드가 생긴 뒤 지난 시간. 1분 미만은 방금 전이다. */
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
