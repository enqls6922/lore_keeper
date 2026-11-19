import { stripChzzkEmotes } from "@/lib/chzzk/text";

/** 채팅 원문은 최근 3분, 최대 1,000개까지 브라우저에 둔다. */
export const CONTEXT_WINDOW_MS = 180_000;
export const SPIKE_WINDOW_MS = 60_000;
export const PRIOR_WINDOW_MS = 5 * 60_000;
export const RADAR_INTERVAL_MS = 30_000;
export const MAX_BUFFERED_CHATS = 1_000;
export const RADAR_SAMPLE_LIMIT = 120;
export const SUMMARY_LIMIT = 25;
export const HIGH_CHEESE = 10_000;
export const SPIKE_MIN_COUNT = 15;
export const RADAR_VISIBLE_MS = 3 * 60 * 1000;
export const DONATION_FADE_MS = 3 * 60 * 1000;
export const HIGH_DONATION_FADE_MS = 10 * 60 * 1000;

export type RadarTrigger = "SPIKE" | "ISSUE" | "COACHING";
export type BriefingCategory = "ISSUE" | "QUESTION" | "MOOD" | "CHEESE";
export type MarkerTrigger = "CHAT_SPIKE" | "BIG_DONATION";

export const COACHING_SUMMARY = "훈수/논쟁 과열 감지 — 화제 전환 권장";

export interface TimedChat {
  message: string;
  at: number;
}

const NOISE_CHAT = /^[ㄱ-ㅎㅏ-ㅣ?!.~ㅋㅎㅠ]+$/;
const ISSUE_KEYWORDS = ["소리", "마이크", "화면", "렉", "싱크", "끊김", "bgm"];
const COACHING_PATTERN = /훈수|그건 아니|왜 그렇게|틀렸|잘못|에바|싸우|논쟁|그럴 게 아니|짜증|별로/;

export function isRadarTrigger(value: unknown): value is RadarTrigger {
  return value === "SPIKE" || value === "ISSUE" || value === "COACHING";
}

export function isBriefingCategory(value: unknown): value is BriefingCategory {
  return value === "ISSUE" || value === "QUESTION" || value === "MOOD" || value === "CHEESE";
}

export function isMarkerTrigger(value: unknown): value is MarkerTrigger {
  return value === "CHAT_SPIKE" || value === "BIG_DONATION";
}

export function pushTimedChat(buffer: TimedChat[], message: string, at: number): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return;
  }
  buffer.push({ message: trimmed.slice(0, 200), at });
  pruneTimedChats(buffer, at);
}

export function pruneTimedChats(buffer: TimedChat[], now: number): void {
  const cutoff = now - CONTEXT_WINDOW_MS;
  while (buffer.length > 0 && buffer[0].at < cutoff) {
    buffer.shift();
  }
  if (buffer.length > MAX_BUFFERED_CHATS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_CHATS);
  }
}

/** 창 안에 남은 수신 채팅 수. 샘플을 거치기 전의 건수다. */
export function countInWindow(buffer: TimedChat[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (const chat of buffer) {
    if (chat.at >= cutoff) {
      count += 1;
    }
  }
  return count;
}

export function messagesInWindow(buffer: TimedChat[], now: number): string[] {
  pruneTimedChats(buffer, now);
  return buffer.map((chat) => chat.message);
}

/** 채팅 문장 없이 시각만 5분+현재 창까지 남긴다. 화력 평균을 계산할 때 쓴다. */
export function rememberChatTime(times: number[], at: number): void {
  times.push(at);
  const cutoff = at - PRIOR_WINDOW_MS - SPIKE_WINDOW_MS;
  while (times.length > 0 && times[0] < cutoff) {
    times.shift();
  }
}

/** 지금 60초를 뺀 직전 5분의 수신 채팅 수. */
export function priorFiveMinuteCount(times: number[], now: number): number {
  const start = now - PRIOR_WINDOW_MS - SPIKE_WINDOW_MS;
  const end = now - SPIKE_WINDOW_MS;
  return times.filter((time) => time >= start && time < end).length;
}

/** 시간순을 유지한 채 구간 전체에서 균등하게 고른다. */
export function sampleEvenly<T>(items: readonly T[], limit: number): T[] {
  if (limit <= 0 || items.length === 0) {
    return [];
  }
  if (items.length <= limit) {
    return [...items];
  }
  if (limit === 1) {
    return [items[0]];
  }
  const picked: T[] = [];
  const used = new Set<number>();
  const step = (items.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    let chosen = Math.round(index * step);
    while (used.has(chosen) && chosen < items.length - 1) {
      chosen += 1;
    }
    used.add(chosen);
    picked.push(items[chosen]);
  }
  return picked;
}

/** 이모티콘과 자음·모음 단타를 빼고, 120개를 넘으면 3분 구간에서 균등 샘플한다. */
export function prepareRadarMessages(messages: ReadonlyArray<string | TimedChat>): string[] {
  const rows = messages.map((item, index) => {
    const message = stripChzzkEmotes(typeof item === "string" ? item : item.message);
    const at = typeof item === "string" ? index : item.at;
    return { message, at };
  });
  const meaningful = rows
    .filter((row) => row.message.length > 0 && !NOISE_CHAT.test(row.message))
    .sort((left, right) => left.at - right.at);
  return sampleEvenly(meaningful, RADAR_SAMPLE_LIMIT).map((row) => row.message);
}

export function hasIssueKeyword(message: string): boolean {
  const lower = message.toLowerCase();
  return ISSUE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function hasQuestionMark(message: string): boolean {
  return message.includes("?") || message.includes("？");
}

export function isCoachingLine(message: string): boolean {
  return COACHING_PATTERN.test(message);
}

/**
 * 30초마다 검사한다. 빈 배열이면 API를 부르지 않는다.
 * 화력은 직전 5분 분당 평균의 2.5배이고, 최근 60초 수신 채팅이 15개 이상일 때다.
 * recentCount는 필터 전 수신 건수다.
 */
export function detectRadar(messages: string[], recentCount: number, priorFiveMinCount: number): RadarTrigger[] {
  const triggers: RadarTrigger[] = [];
  const averagePerMinute = priorFiveMinCount / 5;
  if (recentCount >= SPIKE_MIN_COUNT && recentCount >= averagePerMinute * 2.5) {
    triggers.push("SPIKE");
  }
  const issueCount = messages.filter((message) => hasIssueKeyword(message) || hasQuestionMark(message)).length;
  if (issueCount >= 3) {
    triggers.push("ISSUE");
  }
  if (messages.filter(isCoachingLine).length >= 3) {
    triggers.push("COACHING");
  }
  return triggers;
}

export function clipText(text: string, limit: number): string {
  return Array.from(text.trim()).slice(0, limit).join("");
}

export function mentionsLoyalty(text: string): boolean {
  return text.includes("누적") || text.includes("단골") || text.includes("방문");
}
