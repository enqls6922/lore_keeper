/** 방송 중 고르는 최소 후원 금액. 이 값만 저장한다. */
export const CHEESE_PRESETS = [1000, 3000, 5000, 10000] as const;

export type CheesePreset = (typeof CHEESE_PRESETS)[number];

/** 추천 멘트에 그대로 쓰는 말투. */
export const STREAM_TONES = ["친근한 반말", "정중한 존댓말", "텐션 높은 리액션", "담백한 진행"] as const;

export type StreamTone = (typeof STREAM_TONES)[number];

export const DEFAULT_STREAM_TONE: StreamTone = "친근한 반말";
export const DEFAULT_MIN_CHEESE: CheesePreset = 1000;
export const MAX_STREAM_CONTEXT = 240;

export function isCheesePreset(value: unknown): value is CheesePreset {
  return typeof value === "number" && CHEESE_PRESETS.some((preset) => preset === value);
}

export function isStreamTone(value: unknown): value is StreamTone {
  return typeof value === "string" && STREAM_TONES.some((tone) => tone === value);
}
