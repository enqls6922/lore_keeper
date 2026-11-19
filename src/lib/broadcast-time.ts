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

/** 서울 오늘 0시의 UTC 시각. 오늘 생성된 행을 셀 때 쓴다. */
export function seoulDayStart(now = new Date()): Date {
  return new Date(`${seoulSessionDate(now)}T00:00:00+09:00`);
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

let originMs: number | null = null;

/** 실시간 연결이 켜질 때만 기준 시각을 둔다. 끄면 경과를 0으로 되돌린다. */
export function armBroadcastClock(origin: number): void {
  originMs = Number.isFinite(origin) ? origin : null;
}

export function stopBroadcastClock(): void {
  originMs = null;
}

/** 연결 기준 시각부터의 경과 초. 대기 중이면 0이다. */
export function broadcastElapsedSec(nowMs = Date.now()): number {
  if (originMs === null) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - originMs) / 1000));
}
