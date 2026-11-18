/** 채팅 원문은 최근 60초, 최대 150개만 브라우저에 둔다. */
export const CHAT_WINDOW_MS = 60_000;
export const PRIOR_WINDOW_MS = 5 * 60_000;
export const RADAR_INTERVAL_MS = 30_000;
export const MAX_BUFFERED_CHATS = 150;
export const SUMMARY_LIMIT = 35;
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
  const cutoff = now - CHAT_WINDOW_MS;
  while (buffer.length > 0 && buffer[0].at < cutoff) {
    buffer.shift();
  }
  if (buffer.length > MAX_BUFFERED_CHATS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_CHATS);
  }
}

export function messagesInWindow(buffer: TimedChat[], now: number): string[] {
  pruneTimedChats(buffer, now);
  return buffer.map((chat) => chat.message);
}

/** 채팅 문장 없이 시각만 5분+현재 창까지 남긴다. 화력 평균을 계산할 때 쓴다. */
export function rememberChatTime(times: number[], at: number): void {
  times.push(at);
  const cutoff = at - PRIOR_WINDOW_MS - CHAT_WINDOW_MS;
  while (times.length > 0 && times[0] < cutoff) {
    times.shift();
  }
}

/** 지금 60초를 뺀 직전 5분의 채팅 수. */
export function priorFiveMinuteCount(times: number[], now: number): number {
  const start = now - PRIOR_WINDOW_MS - CHAT_WINDOW_MS;
  const end = now - CHAT_WINDOW_MS;
  return times.filter((time) => time >= start && time < end).length;
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
 * 화력은 직전 5분 분당 평균의 2.5배이고, 60초 안 채팅이 15개 이상일 때다.
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
