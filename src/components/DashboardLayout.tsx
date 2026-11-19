"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useChzzkChat } from "@/hooks/useChzzkChat";
import { broadcastElapsedSec, formatBroadcastTime } from "@/lib/broadcast-time";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_MIN_CHEESE, isCheesePreset, type CheesePreset } from "@/lib/stream-settings";

const NAV = [
  { href: "/", label: "실시간 상황판" },
  { href: "/timeline", label: "편집 타임라인" },
  { href: "/integrations", label: "OBS · 공유 연동" },
  { href: "/settings", label: "PD 설정" },
  { href: "/billing", label: "플랜 · 결제" },
] as const;

const TITLES: Record<string, string> = {
  "/": "실시간 상황판",
  "/timeline": "편집 타임라인",
  "/integrations": "OBS · 공유 연동",
  "/settings": "PD 설정",
  "/billing": "플랜 · 결제",
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const [nowMs, setNowMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
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
    setChannelIdState(value);
    setChatEnabled(false);
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

  const toggleChat = useCallback((): void => {
    if (channelId.trim().length === 0) {
      notify("PD 설정에서 채널 ID를 먼저 저장해 주세요.");
      return;
    }
    setChatEnabled((current) => !current);
  }, [channelId, notify]);

  const elapsedLabel = nowMs === 0 ? "00:00:00" : formatBroadcastTime(broadcastElapsedSec(nowMs));
  const value: StudioContextValue = {
    account,
    channelId,
    setChannelId,
    minCheeseAmount,
    setMinCheeseAmount,
    savingSettings,
    saveSettings,
    chatEnabled,
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
          <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-white/10 bg-[#121418] px-2 sm:gap-3 sm:px-4">
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
            <h1 className="w-24 shrink-0 truncate text-xs font-extrabold sm:w-auto sm:min-w-0 sm:flex-1 sm:text-base">{title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#AEB6C9] sm:text-sm">{elapsedLabel}</span>
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
                className={`whitespace-nowrap rounded-full px-2 py-1.5 text-[11px] font-extrabold sm:px-4 sm:py-2 sm:text-sm ${
                  chatEnabled ? "border border-white/10 text-white" : "bg-[#00FFA3] text-[#090A0B]"
                }`}
              >
                {chatEnabled ? "연결 중지" : "실시간 연결"}
              </button>
            </div>
          </header>
          {chat.liveTitle || chat.errorMessage ? (
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
