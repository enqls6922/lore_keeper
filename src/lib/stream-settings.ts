/** 방송 중 고르는 최소 후원 금액. 이 값만 저장한다. */
export const CHEESE_PRESETS = [1000, 3000, 5000, 10000] as const;

export type CheesePreset = (typeof CHEESE_PRESETS)[number];

/** 추천 멘트 어미. 하나만 고른다. */
export const SPEECH_LEVELS = ["친근한 반말", "정중한 존댓말", "반존대"] as const;

export type SpeechLevel = (typeof SPEECH_LEVELS)[number];

/** 함께 섞는 스타일 태그. 여러 개를 고를 수 있다. */
export const TONE_TAGS = ["텐션 높음", "시크·무심", "장난기·티키타카", "다정·감사", "겜방·드립"] as const;

export type ToneTag = (typeof TONE_TAGS)[number];

export const TONE_TAG_LABELS: Record<ToneTag, string> = {
  "텐션 높음": "🔥 텐션 높음",
  "시크·무심": "😎 시크·무심",
  "장난기·티키타카": "🤣 장난기·티키타카",
  "다정·감사": "🥰 다정·감사",
  "겜방·드립": "🎮 겜방·드립",
};

/** 미사용 자동 로그아웃. 0이면 끄기. */
export const LOGOUT_PRESETS = [0, 30, 60, 180, 360] as const;

export type LogoutMinutes = (typeof LOGOUT_PRESETS)[number];

export const LOGOUT_LABELS: Record<LogoutMinutes, string> = {
  0: "끄기",
  30: "30분",
  60: "1시간",
  180: "3시간",
  360: "6시간",
};

export const DEFAULT_SPEECH_LEVEL: SpeechLevel = "친근한 반말";
export const DEFAULT_TONE_TAGS: readonly ToneTag[] = ["텐션 높음"];
export const DEFAULT_MIN_CHEESE: CheesePreset = 1000;
export const MAX_STREAM_CONTEXT = 240;
export const MAX_STREAM_HABIT = 240;

export function isCheesePreset(value: unknown): value is CheesePreset {
  return typeof value === "number" && CHEESE_PRESETS.some((preset) => preset === value);
}

export function isSpeechLevel(value: unknown): value is SpeechLevel {
  return typeof value === "string" && SPEECH_LEVELS.some((level) => level === value);
}

export function isToneTag(value: unknown): value is ToneTag {
  return typeof value === "string" && TONE_TAGS.some((tag) => tag === value);
}

export function isLogoutMinutes(value: unknown): value is LogoutMinutes {
  return typeof value === "number" && LOGOUT_PRESETS.some((minutes) => minutes === value);
}

/** 모르는 태그는 거르고, 보여 주는 순서는 고정한다. 빈 배열도 허용한다. */
export function readToneTags(value: unknown): ToneTag[] | null {
  if (!Array.isArray(value) || value.length > TONE_TAGS.length) {
    return null;
  }
  const picked = new Set<ToneTag>();
  for (const item of value) {
    if (!isToneTag(item) || picked.has(item)) {
      return null;
    }
    picked.add(item);
  }
  return TONE_TAGS.filter((tag) => picked.has(tag));
}
