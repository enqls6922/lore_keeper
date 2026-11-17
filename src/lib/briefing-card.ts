/** 대시보드와 API가 공유하는 브리핑 카드. 숫자는 DB에 저장된 값만 담는다. */
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
  summarySnapshot: string;
  suggestedReplies: string[];
  isPinned: boolean;
  isDone: boolean;
  createdAt: string;
  viewer: BriefingViewerSnapshot;
}

const TRIGGER_TYPES: readonly BriefingTriggerType[] = [
  "CHEESE",
  "NEW_VIEWER",
  "RETURNING",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isTriggerType(value: unknown): value is BriefingTriggerType {
  return (
    typeof value === "string" &&
    TRIGGER_TYPES.some((triggerType) => triggerType === value)
  );
}

function isViewerSnapshot(value: unknown): value is BriefingViewerSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.nickname === "string" &&
    isInteger(value.totalCheese) &&
    isInteger(value.visitCount)
  );
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
    typeof value.summarySnapshot === "string" &&
    Array.isArray(value.suggestedReplies) &&
    value.suggestedReplies.every((reply) => typeof reply === "string") &&
    typeof value.isPinned === "boolean" &&
    typeof value.isDone === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export function isBriefingCardList(value: unknown): value is BriefingCard[] {
  return Array.isArray(value) && value.every(isBriefingCard);
}

function briefingRank(card: BriefingCard): number {
  if (card.isPinned && !card.isDone) {
    return 0;
  }
  if (card.isPinned) {
    return 1;
  }
  if (!card.isDone) {
    return 2;
  }
  return 3;
}

/** 고정이 위, 그다음 미완료 최신순, 완료는 맨 아래. */
export function compareBriefingCards(left: BriefingCard, right: BriefingCard): number {
  const rank = briefingRank(left) - briefingRank(right);
  if (rank !== 0) {
    return rank;
  }
  return right.createdAt.localeCompare(left.createdAt);
}
