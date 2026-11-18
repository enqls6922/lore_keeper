/** 채팅 원문은 최근 60초만 브라우저 메모리에 둔다. DB에는 넣지 않는다. */
export const CHAT_WINDOW_MS = 60_000;
export const RADAR_INTERVAL_MS = 30_000;
export const SUMMARY_LIMIT = 35;
export const REASON_LIMIT = 40;
export const HIGH_CHEESE = 10_000;
export const RADAR_VISIBLE_MS = 3 * 60 * 1000;
export const DONATION_FADE_MS = 3 * 60 * 1000;

export type RadarSignal = "SPIKE" | "QUESTION" | "ISSUE" | "COACHING";

export interface TimedChat {
  message: string;
  at: number;
}

const ISSUE_KEYWORDS = ["소리", "마이크", "화면", "렉", "bgm"];
const COACHING_PATTERN = /훈수|그건 아니|왜 그렇게|틀렸|잘못|에바|싸우|논쟁|그럴 게 아니/;

/** 조용한 방이 갑자기 터질 때 쓰는 최소 개수. 평균이 0이면 이 값부터 화력으로 본다. */
const SPIKE_FROM_SILENCE = 12;
const SPIKE_FLOOR = 5;

export function isRadarSignal(value: unknown): value is RadarSignal {
  return value === "SPIKE" || value === "QUESTION" || value === "ISSUE" || value === "COACHING";
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
  if (buffer.length > 240) {
    buffer.splice(0, buffer.length - 240);
  }
}

export function messagesInWindow(buffer: TimedChat[], now: number): string[] {
  pruneTimedChats(buffer, now);
  return buffer.map((chat) => chat.message);
}

function countMatching(messages: string[], test: (message: string) => boolean): number {
  return messages.filter(test).length;
}

/**
 * 30초마다 호출한다. 조건이 없으면 null이라 API를 부르지 않는다.
 * 화력이 가장 우선이고, 그다음 방송 이슈, 공통 질문, 훈수다.
 */
export function detectRadar(messages: string[], baselines: number[]): RadarSignal | null {
  const count = messages.length;
  let signal: RadarSignal | null = null;

  if (baselines.length > 0) {
    const average = baselines.reduce((sum, value) => sum + value, 0) / baselines.length;
    const needed = average <= 0 ? SPIKE_FROM_SILENCE : Math.max(SPIKE_FLOOR, average * 2.5);
    if (count >= needed) {
      signal = "SPIKE";
    }
  }

  const issueCount = countMatching(messages, (message) => {
    const lower = message.toLowerCase();
    return ISSUE_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
  const questionCount = countMatching(messages, (message) => message.includes("?") || message.includes("？"));
  const coachingCount = countMatching(messages, (message) => COACHING_PATTERN.test(message));

  if (!signal && issueCount >= 3) {
    signal = "ISSUE";
  }
  if (!signal && questionCount >= 3) {
    signal = "QUESTION";
  }
  if (!signal && coachingCount >= 3) {
    signal = "COACHING";
  }
  return signal;
}

/** 이번 60초 개수를 다음 비교의 평균에 넣는다. 최근 8창만 남긴다. */
export function pushBaseline(baselines: number[], count: number): void {
  baselines.push(count);
  if (baselines.length > 8) {
    baselines.splice(0, baselines.length - 8);
  }
}

export function clipText(text: string, limit: number): string {
  return Array.from(text.trim()).slice(0, limit).join("");
}

export function mentionsLoyalty(text: string): boolean {
  return text.includes("누적") || text.includes("단골") || text.includes("방문");
}
