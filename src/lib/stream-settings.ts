/** 방송 중 고르는 최소 후원 금액. 이 값만 저장한다. */
export const CHEESE_PRESETS = [1000, 3000, 5000, 10000] as const;

export type CheesePreset = (typeof CHEESE_PRESETS)[number];

export const DEFAULT_MIN_CHEESE: CheesePreset = 1000;

export function isCheesePreset(value: unknown): value is CheesePreset {
  return typeof value === "number" && CHEESE_PRESETS.some((preset) => preset === value);
}
