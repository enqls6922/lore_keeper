"use client";

import { useEffect, useRef, useState } from "react";

import { isAnonymousDonor } from "@/lib/anonymous";
import { broadcastElapsedSec } from "@/lib/broadcast-time";
import {
  buildChzzkHandshake,
  buildChzzkPing,
  buildChzzkPong,
  CHZZK_CHAT_URL,
  CHZZK_PING_MS,
  parseChzzkFrame,
  type ChzzkInboundEvent,
} from "@/lib/chzzk/frame";
import type { ChzzkSession } from "@/lib/chzzk/session";
import {
  RADAR_INTERVAL_MS,
  detectRadar,
  messagesInWindow,
  priorFiveMinuteCount,
  pushTimedChat,
  rememberChatTime,
  type RadarTrigger,
  type TimedChat,
} from "@/lib/chat-radar";

export type ChzzkLinkStatus = "idle" | "connecting" | "live" | "offline" | "error";

export interface ChzzkChatState {
  status: ChzzkLinkStatus;
  liveTitle: string | null;
  errorMessage: string | null;
}

const IDLE_STATE: ChzzkChatState = {
  status: "idle",
  liveTitle: null,
  errorMessage: null,
};
const SIGNAL_COOLDOWN_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSession(value: unknown): value is ChzzkSession {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.chatChannelId === "string" &&
    typeof value.accessToken === "string" &&
    typeof value.liveTitle === "string"
  );
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  return fallback;
}

async function loadSession(channelId: string, signal: AbortSignal): Promise<ChzzkSession> {
  const response = await fetch(`/api/chzzk/session?channelId=${encodeURIComponent(channelId)}`, {
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isSession(payload)) {
    throw new Error(readErrorMessage(payload, "치지직 세션을 가져오지 못했습니다."));
  }
  return payload;
}

async function postDonation(event: ChzzkInboundEvent, recentChats: string[]): Promise<void> {
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userIdHash: event.userIdHash,
      nickname: event.nickname,
      message: event.message,
      cheeseAmount: event.cheeseAmount,
      recentChats,
      elapsedSec: broadcastElapsedSec(),
    }),
  });
  if (!response.ok) {
    console.error("[치지직] 후원 요약을 저장하지 못했습니다.");
  }
}

function rememberChat(buffer: TimedChat[], times: number[], event: ChzzkInboundEvent): void {
  if (isAnonymousDonor(event.userIdHash, event.nickname)) {
    return;
  }
  const now = Date.now();
  pushTimedChat(buffer, event.message, now);
  rememberChatTime(times, now);
}

function handleInbound(event: ChzzkInboundEvent, buffer: TimedChat[], times: number[]): void {
  if (event.message.length === 0 && event.cheeseAmount <= 0) {
    return;
  }
  if (event.cheeseAmount <= 0) {
    rememberChat(buffer, times, event);
    return;
  }
  const recentChats = messagesInWindow(buffer, Date.now()).slice(-20);
  void postDonation(event, recentChats).catch((error: unknown) => {
    const text = error instanceof Error ? error.message : "후원 저장 실패";
    console.error(`[치지직] ${text}`);
  });
  if (event.message.length > 0) {
    rememberChat(buffer, times, event);
  }
}

async function postRadar(triggers: RadarTrigger[], messages: string[]): Promise<void> {
  const response = await fetch("/api/radar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      triggers,
      messages: messages.slice(-80),
      elapsedSec: broadcastElapsedSec(),
    }),
  });
  if (!response.ok) {
    console.error("[레이더] 채팅 분석을 저장하지 못했습니다.");
  }
}

function scanRadar(buffer: TimedChat[], times: number[], lastFired: Map<RadarTrigger, number>): void {
  const now = Date.now();
  const messages = messagesInWindow(buffer, now);
  const triggers = detectRadar(messages, messages.length, priorFiveMinuteCount(times, now)).filter((trigger) => {
    const firedAt = lastFired.get(trigger) ?? 0;
    return now - firedAt >= SIGNAL_COOLDOWN_MS;
  });
  if (triggers.length === 0) {
    return;
  }
  for (const trigger of triggers) {
    lastFired.set(trigger, now);
  }
  void postRadar(triggers, messages).catch((error: unknown) => {
    for (const trigger of triggers) {
      lastFired.delete(trigger);
    }
    const text = error instanceof Error ? error.message : "레이더 실패";
    console.error(`[레이더] ${text}`);
  });
}

function waitForSocket(session: ChzzkSession, stopped: () => boolean, buffer: TimedChat[], times: number[]): Promise<void> {
  return new Promise((resolve) => {
    const socket = new WebSocket(CHZZK_CHAT_URL);
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pingTimer);
      resolve();
    };

    const pingTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(buildChzzkPing()));
      }
    }, CHZZK_PING_MS);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(buildChzzkHandshake(session)));
    });

    socket.addEventListener("message", (message) => {
      if (typeof message.data !== "string") {
        return;
      }
      const frame = parseChzzkFrame(message.data);
      if (frame.shouldPong && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(buildChzzkPong()));
      }
      for (const event of frame.events) {
        handleInbound(event, buffer, times);
      }
    });

    socket.addEventListener("close", finish);
    socket.addEventListener("error", finish);

    const stopWatch = window.setInterval(() => {
      if (!stopped()) {
        return;
      }
      window.clearInterval(stopWatch);
      socket.close();
      finish();
    }, 200);

    socket.addEventListener("close", () => {
      window.clearInterval(stopWatch);
    });
  });
}

/**
 * 브라우저에서 치지직 채팅에 붙는다.
 * 일반 채팅은 최근 60초만 메모리에 두고, 30초마다 조건이 맞을 때만 레이더를 부른다.
 * 치즈 후원만 서버에 한 줄 요약을 요청한다.
 */
export function useChzzkChat(channelId: string, enabled: boolean): ChzzkChatState {
  const [state, setState] = useState<ChzzkChatState>(IDLE_STATE);
  const bufferRef = useRef<TimedChat[]>([]);
  const timesRef = useRef<number[]>([]);
  const lastFiredRef = useRef<Map<RadarTrigger, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      scanRadar(bufferRef.current, timesRef.current, lastFiredRef.current);
    }, RADAR_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    const trimmed = channelId.trim();
    bufferRef.current = [];
    timesRef.current = [];
    lastFiredRef.current.clear();
    if (!enabled || trimmed.length === 0) {
      return;
    }

    const abort = new AbortController();
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async (): Promise<void> => {
      setState({ status: "connecting", liveTitle: null, errorMessage: null });
      try {
        const session = await loadSession(trimmed, abort.signal);
        if (stopped) {
          return;
        }
        setState({ status: "live", liveTitle: session.liveTitle, errorMessage: null });
        await waitForSocket(session, () => stopped, bufferRef.current, timesRef.current);
        if (stopped) {
          return;
        }
        setState({
          status: "offline",
          liveTitle: session.liveTitle,
          errorMessage: "채팅 연결이 끊어졌습니다. 다시 붙는 중입니다.",
        });
        reconnectTimer = setTimeout(() => {
          void run();
        }, 3_000);
      } catch (error: unknown) {
        if (stopped || abort.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        const message = error instanceof Error ? error.message : "치지직 연결에 실패했습니다.";
        const offline = message.includes("방송 중");
        setState({
          status: offline ? "offline" : "error",
          liveTitle: null,
          errorMessage: message,
        });
        reconnectTimer = setTimeout(() => {
          void run();
        }, 5_000);
      }
    };

    void run();

    return () => {
      stopped = true;
      abort.abort();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      setState(IDLE_STATE);
    };
  }, [channelId, enabled]);

  if (!enabled || channelId.trim().length === 0) {
    return IDLE_STATE;
  }
  return state;
}
