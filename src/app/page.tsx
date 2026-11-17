"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useChzzkChat } from "@/hooks/useChzzkChat";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  compareBriefingCards,
  isBriefingCard,
  isBriefingCardList,
  type BriefingCard,
  type BriefingTriggerType,
} from "@/lib/briefing-card";

const POLL_MS = 2_000;
const TOAST_MS = 1_600;
const REGULAR_HASH = "user_regular_demo";
const REGULAR_CHEESE = 10_000;

type PollStatus = "loading" | "live" | "offline";

interface SimulatorEvent {
  userIdHash: string;
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats?: string[];
  forceBriefing?: boolean;
}

function formatCount(value: number): string {
  return value.toLocaleString("ko-KR");
}

function badgeLabel(card: BriefingCard): string {
  if (card.triggerType === "CHEESE") {
    return `치즈 ${formatCount(card.cheeseAmount)}`;
  }
  if (card.triggerType === "NEW_VIEWER") {
    return "첫 방문";
  }
  return "재방문";
}

function badgeClass(triggerType: BriefingTriggerType): string {
  if (triggerType === "CHEESE") {
    return "bg-[#3A2E08] text-[#FFE08A]";
  }
  if (triggerType === "NEW_VIEWER") {
    return "bg-[#0E2E1C] text-[#7DFFB3]";
  }
  return "bg-[#1A2233] text-[#C9D4EA]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface AccountProfile {
  email: string;
  chzzkChannelId: string | null;
}

function isAccountProfile(value: unknown): value is AccountProfile {
  if (!isRecord(value) || typeof value.email !== "string") {
    return false;
  }
  return value.chzzkChannelId === null || typeof value.chzzkChannelId === "string";
}

function readPostedBriefing(value: unknown): BriefingCard | null {
  if (!isRecord(value)) {
    return null;
  }
  return isBriefingCard(value.briefing) ? value.briefing : null;
}

export default function HomePage() {
  const router = useRouter();
  const [cards, setCards] = useState<BriefingCard[]>([]);
  const [pollStatus, setPollStatus] = useState<PollStatus>("loading");
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [savingChannel, setSavingChannel] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const polling = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chat = useChzzkChat(channelId, chatEnabled);

  const applyCards = useCallback((nextCards: BriefingCard[]) => {
    const sorted = [...nextCards].sort(compareBriefingCards);
    if (!firstLoad.current) {
      const arrived = sorted.map((card) => card.id).filter((id) => !knownIds.current.has(id));
      if (arrived.length > 0) {
        setFreshIds(new Set(arrived));
      }
    }
    firstLoad.current = false;
    knownIds.current = new Set(sorted.map((card) => card.id));
    setCards(sorted);
  }, []);

  const mergeCard = useCallback((card: BriefingCard) => {
    setCards((current) => {
      const next = current.some((item) => item.id === card.id)
        ? current.map((item) => (item.id === card.id ? card : item))
        : [card, ...current];
      next.sort(compareBriefingCards);
      knownIds.current = new Set(next.map((item) => item.id));
      return next;
    });
    setFreshIds(new Set([card.id]));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBriefings(): Promise<void> {
      if (polling.current) {
        return;
      }
      polling.current = true;
      try {
        const response = await fetch("/api/briefings", { cache: "no-store" });
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        if (!response.ok) {
          throw new Error("브리핑 목록 요청이 실패했습니다.");
        }
        const payload: unknown = await response.json();
        if (!isBriefingCardList(payload)) {
          throw new Error("브리핑 응답 형식이 올바르지 않습니다.");
        }
        if (!cancelled) {
          applyCards(payload);
          setPollStatus("live");
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "연결 실패";
        console.error(`[대시보드] ${message}`);
        if (!cancelled) {
          setPollStatus("offline");
        }
      } finally {
        polling.current = false;
      }
    }

    void loadBriefings();
    const timer = setInterval(() => {
      void loadBriefings();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applyCards, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount(): Promise<void> {
      const response = await fetch("/api/user", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isAccountProfile(payload) || cancelled) {
        return;
      }
      setAccountEmail(payload.email);
      if (payload.chzzkChannelId) {
        setChannelId((current) => (current.trim().length > 0 ? current : payload.chzzkChannelId ?? ""));
      }
    }

    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (freshIds.size === 0) {
      return;
    }
    const timer = setTimeout(() => setFreshIds(new Set()), 1_200);
    return () => clearTimeout(timer);
  }, [freshIds]);

  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    if (!("wakeLock" in navigator)) {
      setWakeSupported(false);
      return false;
    }
    try {
      wakeLock.current = await navigator.wakeLock.request("screen");
      setWakeOn(true);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "화면 켜짐 유지 실패";
      console.error(`[Wake Lock] ${message}`);
      setWakeOn(false);
      return false;
    }
  }, []);

  useEffect(() => {
    async function keepAwake(): Promise<void> {
      if (document.visibilityState !== "visible" || !wakeOn) {
        return;
      }
      await requestWakeLock();
    }

    function onVisibilityChange(): void {
      void keepAwake();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestWakeLock, wakeOn]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
      void wakeLock.current?.release();
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  async function saveChannel(): Promise<void> {
    setSavingChannel(true);
    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chzzkChannelId: channelId.trim() }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isAccountProfile(payload)) {
        const message =
          isRecord(payload) && typeof payload.message === "string" ? payload.message : "채널 ID를 저장하지 못했습니다.";
        showToast(message);
        return;
      }
      setAccountEmail(payload.email);
      showToast("채널 ID를 저장했습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "채널 저장 실패";
      console.error(`[채널] ${message}`);
      showToast("채널 ID를 저장하지 못했습니다.");
    } finally {
      setSavingChannel(false);
    }
  }

  async function logout(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push("/login");
    router.refresh();
  }

  async function toggleWake(): Promise<void> {
    if (!("wakeLock" in navigator)) {
      setWakeSupported(false);
      return;
    }
    if (wakeOn) {
      await wakeLock.current?.release();
      wakeLock.current = null;
      setWakeOn(false);
      return;
    }
    await requestWakeLock();
  }

  async function togglePin(id: string): Promise<void> {
    const response = await fetch("/api/briefings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      return;
    }
    const payload: unknown = await response.json();
    if (!isBriefingCard(payload)) {
      return;
    }
    setCards((current) => {
      const next = current.map((card) => (card.id === payload.id ? payload : card));
      next.sort(compareBriefingCards);
      return next;
    });
  }

  async function copyReply(reply: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(reply);
    } catch {
      const field = document.createElement("textarea");
      field.value = reply;
      field.setAttribute("readonly", "true");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    showToast("복사됨!");
  }

  async function sendSimulator(event: SimulatorEvent): Promise<void> {
    if (sending) {
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.message === "string"
            ? payload.message
            : "시뮬레이터 이벤트를 보내지 못했습니다.";
        showToast(message);
        return;
      }
      const card = readPostedBriefing(payload);
      if (card) {
        mergeCard(card);
        return;
      }
      showToast("이벤트는 저장됐고, 브리핑은 만들지 못했습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "시뮬레이터 전송 실패";
      console.error(`[시뮬레이터] ${message}`);
      showToast("시뮬레이터 이벤트를 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  const statusText = chatEnabled
    ? chat.status === "live"
      ? "실시간 연결 중"
      : chat.status === "connecting"
        ? "연결하는 중"
        : chat.status === "offline"
          ? "방송 채팅에 붙지 못했습니다"
          : chat.status === "error"
            ? "연결 오류"
            : "대기 중"
    : pollStatus === "live"
      ? "브리핑 수신 중"
      : pollStatus === "loading"
        ? "연결하는 중"
        : "브리핑 연결이 끊겼습니다";
  const statusLive = chatEnabled ? chat.status === "live" : pollStatus === "live";
  const statusDot = statusLive ? "bg-[#3DDC97]" : statusText.includes("중") ? "bg-[#8B93A7]" : "bg-[#FF5C5C]";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-black text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.65rem] font-extrabold tracking-tight">LoreKeeper</h1>
            {accountEmail ? <p className="truncate text-sm font-semibold text-[#AEB6C9]">{accountEmail}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                void toggleWake();
              }}
              disabled={!wakeSupported}
              className={`min-h-12 rounded-full px-3 text-sm font-bold ${
                wakeOn ? "bg-[#143226] text-[#B6FFD8]" : "bg-[#14171F] text-white"
              } disabled:text-[#8B93A7]`}
            >
              {wakeSupported ? (wakeOn ? "화면 유지 중" : "화면 켜 두기") : "화면 유지 불가"}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="min-h-12 rounded-full bg-[#14171F] px-3 text-sm font-bold text-white"
            >
              로그아웃
            </button>
          </div>
        </div>

        <label className="mt-3 block text-sm font-bold text-[#AEB6C9]" htmlFor="channel-id">
          치지직 채널 ID
          <input
            id="channel-id"
            value={channelId}
            onChange={(event) => {
              setChannelId(event.target.value);
              setChatEnabled(false);
            }}
            placeholder="채널 ID"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1 min-h-12 w-full rounded-2xl bg-[#14171F] px-4 text-base font-semibold text-white outline-none placeholder:text-[#6E768A]"
          />
        </label>

        <button
          type="button"
          disabled={savingChannel}
          onClick={() => {
            void saveChannel();
          }}
          className="mt-2 min-h-12 w-full rounded-2xl bg-[#14171F] text-base font-extrabold text-white disabled:text-[#8B93A7]"
        >
          {savingChannel ? "저장 중" : "채널 저장"}
        </button>

        <button
          type="button"
          disabled={channelId.trim().length === 0}
          onClick={() => {
            setChatEnabled((current) => !current);
          }}
          className={`mt-2 min-h-12 w-full rounded-2xl text-base font-extrabold disabled:text-[#8B93A7] ${
            chatEnabled ? "bg-[#3A1214] text-[#FFB4B4]" : "bg-[#14171F] text-white"
          }`}
        >
          {chatEnabled ? "연결 끊기" : "실시간 연결"}
        </button>

        <p className="mt-2 flex items-center gap-2 text-base font-semibold text-[#D7DDEA]">
          <span
            className={`inline-block h-3 w-3 rounded-full ${statusDot} ${statusLive ? "shadow-[0_0_10px_#3DDC97]" : ""}`}
          />
          {statusText}
        </p>
        {chat.liveTitle ? <p className="mt-1 text-sm font-semibold text-[#AEB6C9]">{chat.liveTitle}</p> : null}
        {chat.errorMessage ? <p className="mt-1 text-sm font-semibold text-[#FFB4B4]">{chat.errorMessage}</p> : null}
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 py-4 pb-36">
        {cards.length === 0 ? (
          <p className="rounded-[20px] bg-[#14171F] px-5 py-8 text-lg leading-7 text-[#C4CAD8]">
            {pollStatus === "offline"
              ? "브리핑을 불러오지 못했습니다. 잠시 후 다시 시도합니다."
              : "아직 올라온 브리핑이 없습니다. 후원이나 첫 방문이 오면 여기에 뜹니다."}
          </p>
        ) : (
          cards.map((card) => (
            <article
              key={card.id}
              className={`rounded-[22px] bg-[#14171F] px-4 py-4 ${
                freshIds.has(card.id) ? "ring-2 ring-[#3DDC97]" : ""
              } ${card.isPinned ? "outline outline-1 outline-[#FFE08A]/50" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${badgeClass(card.triggerType)}`}>
                      {badgeLabel(card)}
                    </span>
                    <span className="truncate text-lg font-bold">{card.viewer.nickname}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#AEB6C9]">
                    누적 치즈 {formatCount(card.viewer.totalCheese)} · 방문 {formatCount(card.viewer.visitCount)}회
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void togglePin(card.id);
                  }}
                  className={`min-h-12 shrink-0 rounded-2xl px-3 text-sm font-bold ${
                    card.isPinned ? "bg-[#3A2E08] text-[#FFE08A]" : "bg-black text-[#D7DDEA]"
                  }`}
                >
                  {card.isPinned ? "고정됨" : "고정"}
                </button>
              </div>

              <p className="mt-4 text-[1.65rem] font-extrabold leading-snug tracking-tight text-white">
                {card.summarySnapshot}
              </p>

              <div className="mt-4 flex flex-col gap-2">
                {card.suggestedReplies.slice(0, 2).map((reply, index) => (
                  <button
                    key={`${card.id}-${index}`}
                    type="button"
                    onClick={() => {
                      void copyReply(reply);
                    }}
                    className="min-h-12 rounded-2xl bg-black px-4 py-3 text-left text-lg font-bold leading-6 text-white active:bg-[#222838]"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </main>

      <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-white/10 bg-black px-4 py-3">
        <p className="text-sm font-extrabold text-[#D7DDEA]">🧪 시뮬레이터</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendSimulator({
                userIdHash: REGULAR_HASH,
                nickname: "단골팬",
                message: "오늘도 치즈 보낼게",
                cheeseAmount: REGULAR_CHEESE,
              });
            }}
            className="min-h-12 rounded-2xl bg-[#3A2E08] px-2 text-sm font-extrabold text-[#FFE08A] disabled:opacity-60"
          >
            💰 단골 1만 치즈 후원
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendSimulator({
                userIdHash: `user_new_${crypto.randomUUID()}`,
                nickname: "새시청자",
                message: "처음 들렀어요",
                cheeseAmount: 0,
                forceBriefing: true,
              });
            }}
            className="min-h-12 rounded-2xl bg-[#0E2E1C] px-2 text-sm font-extrabold text-[#7DFFB3] disabled:opacity-60"
          >
            🌱 뉴비 첫 채팅
          </button>
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-full bg-white px-5 py-3 text-base font-extrabold text-black"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
