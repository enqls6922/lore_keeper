"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildChzzkHandshake,
  buildChzzkPing,
  buildChzzkPong,
  CHZZK_CHAT_URL,
  CHZZK_CMD_CHAT,
  CHZZK_CMD_DONATION,
  CHZZK_PING_MS,
  parseChzzkFrame,
  type ChzzkInboundEvent,
} from "@/lib/chzzk/frame";
import { copyRecentChats, pushRecentChat } from "@/lib/chzzk/recent-chats";
import type { ChzzkSession } from "@/lib/chzzk/session";

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
    }),
  });
  if (!response.ok) {
    throw new Error("후원 이벤트를 저장하지 못했습니다.");
  }
}

function handleInbound(event: ChzzkInboundEvent, recentChats: Map<string, string[]>): void {
  if (event.cmd === CHZZK_CMD_CHAT && event.cheeseAmount <= 0) {
    pushRecentChat(recentChats, event.userIdHash, event.message);
    return;
  }
  if (event.cmd !== CHZZK_CMD_DONATION && event.cheeseAmount <= 0) {
    return;
  }
  const chats = copyRecentChats(recentChats, event.userIdHash);
  void postDonation(event, chats).catch((error: unknown) => {
    const text = error instanceof Error ? error.message : "후원 저장 실패";
    console.error(`[치지직] ${text}`);
  });
}

function waitForSocket(
  session: ChzzkSession,
  stopped: () => boolean,
  recentChats: Map<string, string[]>,
): Promise<void> {
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
        handleInbound(event, recentChats);
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
 * 브라우저에서 치지직 채팅 소켓에 붙는다.
 * 일반 채팅은 userIdHash별 최근 15개만 메모리에 두고, 치즈 후원일 때만 /api/events 로 보낸다.
 * enabled 가 꺼지면 소켓과 20초 핑을 정리한다.
 */
export function useChzzkChat(channelId: string, enabled: boolean): ChzzkChatState {
  const [state, setState] = useState<ChzzkChatState>(IDLE_STATE);
  const recentChatsRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const trimmed = channelId.trim();
    recentChatsRef.current.clear();
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
        await waitForSocket(session, () => stopped, recentChatsRef.current);
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
