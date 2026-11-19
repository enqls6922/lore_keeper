/** 시각이 서울 기준 오늘인지 본다. 시계가 아직 0이면 오늘로 세지 않는다. */
export function isSeoulToday(iso: string, nowMs: number): boolean {
  if (nowMs <= 0) {
    return false;
  }
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) {
    return false;
  }
  return seoulSessionDate(created) === seoulSessionDate(new Date(nowMs));
}

/** 서울 날짜의 방송 회차 키. `YYYY-MM-DD`. */
export function seoulSessionDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 방송 경과 초를 `01:24:15`로 바꾼다. */
export function formatBroadcastTime(totalSec: number): string {
  const safe = Number.isFinite(totalSec) ? Math.max(0, Math.floor(totalSec)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

let startedAt = 0;

/** 이 브라우저 탭에서 상황판이 열린 시각부터 센다. 서버 렌더에서는 0이다. */
export function broadcastElapsedSec(nowMs = Date.now()): number {
  if (typeof window === "undefined") {
    return 0;
  }
  if (startedAt === 0) {
    startedAt = nowMs;
  }
  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}
