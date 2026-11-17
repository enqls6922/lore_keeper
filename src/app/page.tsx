"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  compareBriefingCards,
  isBriefingCard,
  isBriefingCardList,
  type BriefingCard,
  type BriefingTriggerType,
} from "@/lib/briefing-card";

const POLL_MS = 2_000;
const TOAST_MS = 1_600;

type LinkStatus = "loading" | "live" | "offline";

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

export default function HomePage() {
  const [cards, setCards] = useState<BriefingCard[]>([]);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("loading");
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const polling = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyCards = useCallback((nextCards: BriefingCard[]) => {
    const sorted = [...nextCards].sort(compareBriefingCards);
    if (!firstLoad.current) {
      const arrived = sorted
        .map((card) => card.id)
        .filter((id) => !knownIds.current.has(id));
      if (arrived.length > 0) {
        setFreshIds(new Set(arrived));
      }
    }
    firstLoad.current = false;
    knownIds.current = new Set(sorted.map((card) => card.id));
    setCards(sorted);
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
        if (!response.ok) {
          throw new Error("브리핑 목록 요청이 실패했습니다.");
        }
        const payload: unknown = await response.json();
        if (!isBriefingCardList(payload)) {
          throw new Error("브리핑 응답 형식이 올바르지 않습니다.");
        }
        if (!cancelled) {
          applyCards(payload);
          setLinkStatus("live");
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "연결 실패";
        console.error(`[대시보드] ${message}`);
        if (!cancelled) {
          setLinkStatus("offline");
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
  }, [applyCards]);

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

    setToast("복사됨!");
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  const statusText =
    linkStatus === "live"
      ? "실시간 감지 중"
      : linkStatus === "loading"
        ? "연결하는 중"
        : "연결이 끊겼습니다";
  const statusDot = linkStatus === "live" ? "bg-[#3DDC97]" : linkStatus === "loading" ? "bg-[#8B93A7]" : "bg-[#FF5C5C]";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-black text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[1.65rem] font-extrabold tracking-tight">LoreKeeper</h1>
          <button
            type="button"
            onClick={() => {
              void toggleWake();
            }}
            disabled={!wakeSupported}
            className={`min-h-12 shrink-0 rounded-full px-4 text-sm font-bold ${
              wakeOn ? "bg-[#143226] text-[#B6FFD8]" : "bg-[#14171F] text-white"
            } disabled:text-[#8B93A7]`}
          >
            {wakeSupported ? (wakeOn ? "화면 유지 중" : "화면 켜 두기") : "화면 유지 불가"}
          </button>
        </div>
        <p className="mt-2 flex items-center gap-2 text-base font-semibold text-[#D7DDEA]">
          <span className={`inline-block h-3 w-3 rounded-full ${statusDot} ${linkStatus === "live" ? "shadow-[0_0_10px_#3DDC97]" : ""}`} />
          {statusText}
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 py-4">
        {cards.length === 0 ? (
          <p className="rounded-[20px] bg-[#14171F] px-5 py-8 text-lg leading-7 text-[#C4CAD8]">
            {linkStatus === "offline"
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

      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-white px-5 py-3 text-base font-extrabold text-black"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
