"use client";

import { useEffect, useRef } from "react";

import { shouldSignOutForIdle } from "@/lib/idle-logout";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
const CHECK_MS = 1_000;

/**
 * 미사용 시간이 지나면 onIdle을 한 번 호출한다.
 * paused가 켜져 있으면 방송 중으로 보고 시간을 세지 않으며, 꺼지는 순간부터 다시 센다.
 */
export function useIdleLogout(options: {
  minutes: number;
  paused: boolean;
  onIdle: () => void;
}): void {
  const onIdleRef = useRef(options.onIdle);
  const pausedRef = useRef(options.paused);
  const lastActivityRef = useRef(0);
  const firedRef = useRef(false);

  useEffect(() => {
    onIdleRef.current = options.onIdle;
    pausedRef.current = options.paused;
  }, [options.onIdle, options.paused]);

  useEffect(() => {
    if (options.minutes <= 0) {
      firedRef.current = false;
      return;
    }

    lastActivityRef.current = Date.now();
    firedRef.current = false;
    const markActive = (): void => {
      lastActivityRef.current = Date.now();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, markActive, { passive: true });
    }

    const timer = window.setInterval(() => {
      if (firedRef.current) {
        return;
      }
      if (
        !shouldSignOutForIdle({
          minutes: options.minutes,
          paused: pausedRef.current,
          lastActivityMs: lastActivityRef.current,
          nowMs: Date.now(),
        })
      ) {
        return;
      }
      firedRef.current = true;
      onIdleRef.current();
    }, CHECK_MS);

    return () => {
      window.clearInterval(timer);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markActive);
      }
    };
  }, [options.minutes]);

  useEffect(() => {
    if (options.paused || options.minutes <= 0) {
      return;
    }
    lastActivityRef.current = Date.now();
    firedRef.current = false;
  }, [options.paused, options.minutes]);
}
