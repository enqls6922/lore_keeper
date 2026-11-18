/** 방송 중이 아니고, 마지막 활동 이후 설정한 분이 지났으면 로그아웃한다. */
export function shouldSignOutForIdle(input: {
  minutes: number;
  paused: boolean;
  lastActivityMs: number;
  nowMs: number;
}): boolean {
  if (input.paused || !Number.isInteger(input.minutes) || input.minutes <= 0) {
    return false;
  }
  return input.nowMs - input.lastActivityMs >= input.minutes * 60_000;
}
