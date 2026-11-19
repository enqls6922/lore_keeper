"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useChzzkChat } from "@/hooks/useChzzkChat";
import { armBroadcastClock, broadcastElapsedSec, formatBroadcastTime, stopBroadcastClock } from "@/lib/broadcast-time";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_MIN_CHEESE, isCheesePreset, type CheesePreset } from "@/lib/stream-settings";

const NAV = [
  { href: "/", label: "📡 실시간 상황판" },
  { href: "/timeline", label: "🎬 타임라인 · AI 패키징" },
  { href: "/integrations", label: "🔗 OBS · 편집자 연동" },
  { href: "/settings", label: "⚙️ 방송 PD 설정" },
  { href: "/billing", label: "💳 플랜 · 사용량" },
] as const;

const TITLES: Record<string, string> = {
  "/": "실시간 상황판",
  "/timeline": "타임라인 · AI 패키징",
  "/integrations": "OBS · 편집자 연동",
  "/settings": "방송 PD 설정",
  "/billing": "플랜 · 사용량",
};

const SHORT_TITLES: Record<string, string> = {
  "/": "상황판",
  "/timeline": "타임라인",
  "/integrations": "연동",
  "/settings": "설정",
  "/billing": "플랜",
};

export interface StudioAccount {
  email: string;
  chzzkChannelId: string | null;
  plan: string;
  aiCredits: number;
  minCheeseAmount: CheesePreset;
  obsToken: string;
  editorShareToken: string;
}

interface StudioContextValue {
  account: StudioAccount | null;
  channelId: string;
  setChannelId: (value: string) => void;
  minCheeseAmount: CheesePreset;
  setMinCheeseAmount: (value: CheesePreset) => void;
  savingSettings: boolean;
  saveSettings: () => Promise<boolean>;
  chatEnabled: boolean;
  liveSynced: boolean;
  toggleChat: () => void;
  liveTitle: string | null;
  chatError: string | null;
  elapsedLabel: string;
  nowMs: number;
  notify: (message: string) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error("대시보드 안에서만 쓸 수 있습니다.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLiveClock(value: unknown): value is { synced: boolean; openDateMs: number | null } {
  if (!isRecord(value) || typeof value.synced !== "boolean") {
    return false;
  }
  return value.openDateMs === null || typeof value.openDateMs === "number";
}

function readAccount(value: unknown): StudioAccount | null {
  if (!isRecord(value) || typeof value.email !== "string" || typeof value.plan !== "string") {
    return null;
  }
  if (typeof value.aiCredits !== "number" || !Number.isInteger(value.aiCredits)) {
    return null;
  }
  const channelId = value.chzzkChannelId;
  if (
    (channelId !== null && typeof channelId !== "string") ||
    !isCheesePreset(value.minCheeseAmount) ||
    typeof value.obsToken !== "string" ||
    typeof value.editorShareToken !== "string"
  ) {
    return null;
  }
  return {
    email: value.email,
    chzzkChannelId: channelId,
    plan: value.plan,
    aiCredits: value.aiCredits,
    minCheeseAmount: value.minCheeseAmount,
    obsToken: value.obsToken,
    editorShareToken: value.editorShareToken,
  };
}

function pageTitle(pathname: string): string {
  return TITLES[pathname] ?? "LoreKeeper";
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<StudioAccount | null>(null);
  const [channelId, setChannelIdState] = useState("");
  const [minCheeseAmount, setMinCheeseAmount] = useState<CheesePreset>(DEFAULT_MIN_CHEESE);
  const [savingSettings, setSavingSettings] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [liveSynced, setLiveSynced] = useState(false);
  const [linking, setLinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const [nowMs, setNowMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const linkSeq = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chat = useChzzkChat(channelId, chatEnabled);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const setChannelId = useCallback((value: string) => {
    linkSeq.current += 1;
    setChannelIdState(value);
    stopBroadcastClock();
    setLiveSynced(false);
    setWaiting(false);
    setChatEnabled(false);
    setLinking(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAccount(): Promise<void> {
      const response = await fetch("/api/user", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      const next = readAccount(payload);
      if (!response.ok || !next || cancelled) {
        return;
      }
      setAccount(next);
      setMinCheeseAmount(next.minCheeseAmount);
      if (next.chzzkChannelId) {
        setChannelIdState((current) => (current.trim().length > 0 ? current : next.chzzkChannelId ?? ""));
      }
    }
    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const tick = (): void => {
      setNowMs(Date.now());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

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

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setSavingSettings(true);
    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chzzkChannelId: channelId.trim(),
          minCheeseAmount,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const next = readAccount(payload);
      if (!response.ok || !next) {
        const message =
          isRecord(payload) && typeof payload.message === "string" ? payload.message : "설정을 저장하지 못했습니다.";
        notify(message);
        return false;
      }
      setAccount(next);
      setChannelIdState(next.chzzkChannelId ?? "");
      setMinCheeseAmount(next.minCheeseAmount);
      notify("설정을 저장했습니다.");
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "설정 저장 실패";
      console.error(`[설정] ${message}`);
      notify("설정을 저장하지 못했습니다.");
      return false;
    } finally {
      setSavingSettings(false);
    }
  }, [channelId, minCheeseAmount, notify]);

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

  const loadOpenDate = useCallback(async (id: string): Promise<number | null> => {
    const response = await fetch(`/api/chzzk/status?channelId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok && isLiveClock(payload) && payload.synced && payload.openDateMs !== null) {
      return payload.openDateMs;
    }
    return null;
  }, []);

  const beginLive = useCallback((origin: number): void => {
    armBroadcastClock(origin);
    setLiveSynced(true);
    setWaiting(false);
    setChatEnabled(true);
  }, []);

  const toggleChat = useCallback((): void => {
    if (linking) {
      return;
    }
    if (channelId.trim().length === 0) {
      notify("PD 설정에서 채널 ID를 먼저 저장해 주세요.");
      return;
    }
    if (chatEnabled || waiting) {
      linkSeq.current += 1;
      stopBroadcastClock();
      setLiveSynced(false);
      setWaiting(false);
      setChatEnabled(false);
      return;
    }
    const seq = linkSeq.current + 1;
    linkSeq.current = seq;
    setLinking(true);
    void (async () => {
      let origin: number | null = null;
      try {
        origin = await loadOpenDate(channelId.trim());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "방송 시각 확인 실패";
        console.error(`[방송 시각] ${message}`);
      }
      if (seq !== linkSeq.current) {
        return;
      }
      if (origin !== null) {
        beginLive(origin);
      } else {
        stopBroadcastClock();
        setLiveSynced(false);
        setChatEnabled(false);
        setWaiting(true);
      }
      setLinking(false);
    })();
  }, [beginLive, channelId, chatEnabled, linking, loadOpenDate, notify, waiting]);

  useEffect(() => {
    if (!waiting) {
      return;
    }
    const seq = linkSeq.current;
    const id = channelId.trim();
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const origin = await loadOpenDate(id);
          if (cancelled || seq !== linkSeq.current || origin === null) {
            return;
          }
          beginLive(origin);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "방송 시각 확인 실패";
          console.error(`[방송 대기] ${message}`);
        }
      })();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [beginLive, channelId, loadOpenDate, waiting]);

  const elapsedLabel =
    !chatEnabled || nowMs === 0 ? "00:00:00" : formatBroadcastTime(broadcastElapsedSec(nowMs));
  const linkOn = chatEnabled || waiting;
  const value: StudioContextValue = {
    account,
    channelId,
    setChannelId,
    minCheeseAmount,
    setMinCheeseAmount,
    savingSettings,
    saveSettings,
    chatEnabled,
    liveSynced,
    toggleChat,
    liveTitle: chat.liveTitle,
    chatError: chat.errorMessage,
    elapsedLabel,
    nowMs,
    notify,
  };

  const title = pageTitle(pathname);

  return (
    <StudioContext.Provider value={value}>
      <div className="min-h-screen bg-[#0B0C0E] text-white">
        {menuOpen ? (
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => {
              setMenuOpen(false);
            }}
          />
        ) : null}
        <aside
          id="studio-nav"
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-[#121418] transition-transform md:translate-x-0 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-white/10 px-5 py-5">
            <p className="text-xl font-extrabold tracking-tight">LoreKeeper</p>
            <p className="mt-1 inline-flex rounded-full bg-[#00FFA3]/15 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#00FFA3]">
              AI STREAM PD
            </p>
          </div>
          <nav aria-label="대시보드" className="flex flex-1 flex-col gap-1 px-3 py-4">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                  className={`rounded-xl px-3 py-2.5 text-sm font-bold ${
                    active ? "bg-[#00FFA3] text-[#090A0B]" : "text-[#D7DDEA] hover:bg-white/5"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-white/10 px-4 py-4 pb-16">
            <p className="truncate text-xs font-semibold text-[#AEB6C9]">{account?.email ?? "계정 확인 중"}</p>
            <p className="mt-2 inline-flex rounded-full border border-[#FFB800]/40 px-2 py-0.5 text-[10px] font-extrabold text-[#FFB800]">
              BETA
            </p>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-white"
            >
              로그아웃
            </button>
          </div>
        </aside>

        <div className="md:pl-64">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-1 overflow-hidden border-b border-white/10 bg-[#121418] px-2 sm:gap-3 sm:px-4">
            <button
              type="button"
              className="flex h-9 w-9 flex-col items-center justify-center gap-1 rounded-lg border border-white/10 md:hidden"
              aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={menuOpen}
              aria-controls="studio-nav"
              onClick={() => {
                setMenuOpen((current) => !current);
              }}
            >
              <span className="block h-0.5 w-4 bg-white" />
              <span className="block h-0.5 w-4 bg-white" />
              <span className="block h-0.5 w-4 bg-white" />
            </button>
            <h1 className="shrink-0 text-xs font-extrabold sm:min-w-0 sm:flex-1 sm:truncate sm:text-base">
              <span className="sm:hidden">{SHORT_TITLES[pathname] ?? "PD"}</span>
              <span className="hidden sm:inline">{title}</span>
            </h1>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <span className="font-mono text-xs font-bold text-[#AEB6C9] sm:text-sm">{elapsedLabel}</span>
              {chatEnabled && liveSynced ? (
                <span className="whitespace-nowrap rounded-full border border-[#FF5A5A]/50 px-1.5 py-0.5 text-[10px] font-extrabold text-[#FF5A5A]">
                  LIVE 동기화
                </span>
              ) : null}
              {waiting ? (
                <span className="whitespace-nowrap rounded-full border border-[#FFB800]/50 px-1.5 py-0.5 text-[10px] font-extrabold text-[#FFB800]">
                  방송 대기 중
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void toggleWake();
                }}
                disabled={!wakeSupported}
                className={`whitespace-nowrap rounded-full border border-white/10 px-2 py-1.5 text-[11px] font-bold disabled:text-[#8B93A7] sm:px-4 sm:py-2 sm:text-sm ${
                  wakeOn ? "bg-[#00FFA3] text-[#090A0B]" : "bg-transparent text-white"
                }`}
              >
                {wakeSupported ? (
                  <>
                    <span className="sm:hidden">{wakeOn ? "유지 중" : "켜 두기"}</span>
                    <span className="hidden sm:inline">{wakeOn ? "화면 유지 중" : "화면 켜 두기"}</span>
                  </>
                ) : (
                  "화면 유지 불가"
                )}
              </button>
              <button
                type="button"
                onClick={toggleChat}
                disabled={linking}
                className={`whitespace-nowrap rounded-full px-2 py-1.5 text-[11px] font-extrabold disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm ${
                  linkOn ? "border border-white/10 text-white" : "bg-[#00FFA3] text-[#090A0B]"
                }`}
              >
                {linking ? "연결 중" : linkOn ? "연결 중지" : "실시간 연결"}
              </button>
            </div>
          </header>
          {waiting ? (
            <p className="border-b border-white/10 bg-[#121418] px-4 py-2 text-sm font-semibold text-[#FFB800]">
              현재 오프라인입니다. 방송이 시작되면 자동으로 동기화됩니다.
            </p>
          ) : null}
          {!waiting && (chat.liveTitle || chat.errorMessage) ? (
            <p className="border-b border-white/10 bg-[#121418] px-4 py-2 text-sm font-semibold text-[#AEB6C9]">
              {chat.errorMessage ? <span className="text-[#FFB4B4]">{chat.errorMessage}</span> : chat.liveTitle}
            </p>
          ) : null}
          <main className="px-4 py-6 md:px-6">{children}</main>
        </div>
        {toast ? (
          <div
            role="status"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#00FFA3] px-5 py-3 text-sm font-extrabold text-[#090A0B]"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </StudioContext.Provider>
  );
}
