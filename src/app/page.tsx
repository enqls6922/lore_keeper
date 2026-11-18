"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useChzzkChat } from "@/hooks/useChzzkChat";
import { ANONYMOUS_NICKNAME } from "@/lib/anonymous";
import {
  compareDonations,
  isBriefingCard,
  isBriefingCardList,
  isDonationFaded,
  isHighlightMarkerCard,
  isHighlightMarkerList,
  isRadarVisible,
  radarBannerLabel,
  type BriefingCard,
  type HighlightMarkerCard,
} from "@/lib/briefing-card";
import { broadcastElapsedSec, formatBroadcastTime } from "@/lib/broadcast-time";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CHEESE_PRESETS, DEFAULT_MIN_CHEESE, isCheesePreset, type CheesePreset } from "@/lib/stream-settings";

const POLL_MS = 2_000;
const TOAST_MS = 1_600;
const REGULAR_HASH = "user_regular_demo";

type PollStatus = "loading" | "live" | "offline";

interface SimulatorEvent {
  userIdHash: string;
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats?: string[];
  elapsedSec: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface AccountProfile {
  email: string;
  chzzkChannelId: string | null;
  minCheeseAmount: CheesePreset;
}

function isAccountProfile(value: unknown): value is AccountProfile {
  if (!isRecord(value) || typeof value.email !== "string") {
    return false;
  }
  const channelOk = value.chzzkChannelId === null || typeof value.chzzkChannelId === "string";
  return channelOk && isCheesePreset(value.minCheeseAmount);
}

function readPostedBriefing(value: unknown): BriefingCard | null {
  if (!isRecord(value) || !isBriefingCard(value.briefing)) {
    return null;
  }
  return value.briefing;
}

function readPostedMarker(value: unknown): HighlightMarkerCard | null {
  if (!isRecord(value) || value.marker === null || value.marker === undefined) {
    return null;
  }
  return isHighlightMarkerCard(value.marker) ? value.marker : null;
}

export default function HomePage() {
  const router = useRouter();
  const [cards, setCards] = useState<BriefingCard[]>([]);
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);
  const [pollStatus, setPollStatus] = useState<PollStatus>("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [minCheeseAmount, setMinCheeseAmount] = useState<CheesePreset>(DEFAULT_MIN_CHEESE);
  const [savingSettings, setSavingSettings] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const polling = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTouched = useRef(false);
  const chat = useChzzkChat(channelId, chatEnabled);

  const applyCards = useCallback((nextCards: BriefingCard[]) => {
    setCards(nextCards);
  }, []);

  const mergeCard = useCallback((card: BriefingCard) => {
    setCards((current) => {
      if (current.some((item) => item.id === card.id)) {
        return current.map((item) => (item.id === card.id ? card : item));
      }
      return [card, ...current];
    });
  }, []);

  const mergeMarker = useCallback((marker: HighlightMarkerCard) => {
    setMarkers((current) => {
      if (current.some((item) => item.id === marker.id)) {
        return current;
      }
      return [...current, marker].sort((left, right) => left.timestampSec - right.timestampSec);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBoard(): Promise<void> {
      if (polling.current) {
        return;
      }
      polling.current = true;
      try {
        const [briefingResponse, markerResponse] = await Promise.all([
          fetch("/api/briefings", { cache: "no-store" }),
          fetch("/api/markers", { cache: "no-store" }),
        ]);
        if (briefingResponse.status === 401 || markerResponse.status === 401) {
          router.push("/login");
          return;
        }
        if (!briefingResponse.ok || !markerResponse.ok) {
          throw new Error("상황판 요청이 실패했습니다.");
        }
        const briefingPayload: unknown = await briefingResponse.json();
        const markerPayload: unknown = await markerResponse.json();
        if (!isBriefingCardList(briefingPayload) || !isHighlightMarkerList(markerPayload)) {
          throw new Error("상황판 응답 형식이 올바르지 않습니다.");
        }
        if (!cancelled) {
          applyCards(briefingPayload);
          setMarkers(markerPayload);
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

    void loadBoard();
    const timer = setInterval(() => {
      void loadBoard();
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
      setMinCheeseAmount(payload.minCheeseAmount);
      if (payload.chzzkChannelId) {
        setChannelId((current) => (current.trim().length > 0 ? current : payload.chzzkChannelId ?? ""));
      } else if (!settingsTouched.current) {
        setSettingsOpen(true);
      }
    }

    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [router]);

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

  useEffect(() => {
    const tick = (): void => {
      setNowMs(Date.now());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  function applyProfile(payload: AccountProfile): void {
    setAccountEmail(payload.email);
    setMinCheeseAmount(payload.minCheeseAmount);
    setChannelId(payload.chzzkChannelId ?? "");
  }

  async function saveSettings(): Promise<void> {
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
      if (!response.ok || !isAccountProfile(payload)) {
        const message =
          isRecord(payload) && typeof payload.message === "string" ? payload.message : "설정을 저장하지 못했습니다.";
        showToast(message);
        return;
      }
      applyProfile(payload);
      showToast("설정을 저장했습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "설정 저장 실패";
      console.error(`[설정] ${message}`);
      showToast("설정을 저장하지 못했습니다.");
    } finally {
      setSavingSettings(false);
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

  async function togglePin(card: BriefingCard): Promise<void> {
    const response = await fetch(`/api/briefings/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !card.isPinned }),
    });
    if (!response.ok) {
      showToast("고정을 바꾸지 못했습니다.");
      return;
    }
    const payload: unknown = await response.json();
    if (isBriefingCard(payload)) {
      mergeCard(payload);
    }
  }

  async function copyTimeline(): Promise<void> {
    const text = markers.map((marker) => `${marker.formattedTime} - ${marker.reason}`).join("\n");
    if (text.length === 0) {
      showToast("복사할 마커가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "true");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    showToast("편집 타임라인을 복사했습니다.");
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
      const marker = readPostedMarker(payload);
      if (card) {
        mergeCard(card);
      }
      if (marker) {
        mergeMarker(marker);
      }
      if (!card && isRecord(payload) && payload.skipReason === "below-minimum") {
        showToast("최소 치즈보다 작아 올리지 않았습니다.");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "시뮬레이터 전송 실패";
      console.error(`[시뮬레이터] ${message}`);
      showToast("시뮬레이터 이벤트를 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function sendRadarTest(): Promise<void> {
    if (sending) {
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: "SPIKE",
          elapsedSec: broadcastElapsedSec(),
          messages: ["보스 클리어!", "ㅋㅋㅋㅋ", "미쳤다", "클립 각", "다시 보자", "채팅 터졌다", "와", "축하해"],
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        showToast("레이더 테스트를 보내지 못했습니다.");
        return;
      }
      const card = readPostedBriefing(payload);
      const marker = readPostedMarker(payload);
      if (card) {
        mergeCard(card);
      }
      if (marker) {
        mergeMarker(marker);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "레이더 테스트 실패";
      console.error(`[레이더] ${message}`);
      showToast("레이더 테스트를 보내지 못했습니다.");
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
      ? "PD 대기 중"
      : pollStatus === "loading"
        ? "연결하는 중"
        : "상황판 연결이 끊겼습니다";
  const statusLive = chatEnabled ? chat.status === "live" : pollStatus === "live";
  const statusDot = statusLive ? "bg-[#00FFA3]" : statusText.includes("중") ? "bg-[#8B93A7]" : "bg-[#FF5C5C]";
  const elapsedLabel = nowMs === 0 ? "00:00:00" : formatBroadcastTime(broadcastElapsedSec(nowMs));
  const radarCards = cards.filter((card) => isRadarVisible(card, nowMs));
  const donations = cards
    .filter((card) => card.type === "DONATION")
    .sort((left, right) => compareDonations(left, right, nowMs));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-[#0E0F11] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0E0F11] px-4 pb-3 pt-4">
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
              className={`min-h-12 rounded-full border border-white/10 px-3 text-sm font-bold ${
                wakeOn ? "bg-[#00FFA3] text-[#090A0B]" : "bg-[#16181C] text-white"
              } disabled:text-[#8B93A7]`}
            >
              {wakeSupported ? (wakeOn ? "화면 유지 중" : "화면 켜 두기") : "화면 유지 불가"}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="min-h-12 rounded-full border border-white/10 bg-[#16181C] px-3 text-sm font-bold text-white"
            >
              로그아웃
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={channelId.trim().length === 0}
          onClick={() => {
            setChatEnabled((current) => !current);
          }}
          className={`mt-3 min-h-12 w-full rounded-2xl text-base font-extrabold disabled:bg-[#16181C] disabled:text-[#8B93A7] ${
            chatEnabled ? "border border-white/10 bg-[#16181C] text-white" : "bg-[#00FFA3] text-[#090A0B]"
          }`}
        >
          {chatEnabled ? "연결 끊기" : "실시간 연결"}
        </button>

        <button
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => {
            settingsTouched.current = true;
            setSettingsOpen((current) => !current);
          }}
          className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#16181C] text-base font-extrabold text-white"
        >
          {settingsOpen ? "설정 접기" : "설정 펼치기"}
        </button>

        <p className="mt-2 flex items-center gap-2 text-base font-semibold text-[#D7DDEA]">
          <span
            className={`inline-block h-3 w-3 rounded-full ${statusDot} ${statusLive ? "shadow-[0_0_10px_#3DDC97]" : ""}`}
          />
          {statusText}
          <span className="ml-auto text-sm font-bold text-[#8B93A7]">{elapsedLabel}</span>
        </p>
        {chat.liveTitle ? <p className="mt-1 text-sm font-semibold text-[#AEB6C9]">{chat.liveTitle}</p> : null}
        {chat.errorMessage ? <p className="mt-1 text-sm font-semibold text-[#FFB4B4]">{chat.errorMessage}</p> : null}
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 py-4 pb-8">
        {settingsOpen ? (
          <form
            className="rounded-[22px] border border-white/10 bg-[#16181C] px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <label className="block text-sm font-bold text-[#AEB6C9]" htmlFor="channel-id">
              내 채널 ID
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
                className="mt-1 min-h-12 w-full rounded-2xl border border-white/10 bg-[#0E0F11] px-4 text-base font-semibold text-white outline-none placeholder:text-[#6E768A]"
              />
            </label>

            <p className="mt-4 text-sm font-bold text-[#AEB6C9]">최소 치즈 금액</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {CHEESE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={minCheeseAmount === preset}
                  onClick={() => {
                    setMinCheeseAmount(preset);
                  }}
                  className={`min-h-12 rounded-2xl text-sm font-extrabold ${
                    minCheeseAmount === preset
                      ? "bg-[#00FFA3] text-[#090A0B]"
                      : "border border-white/10 bg-[#0E0F11] text-[#D7DDEA]"
                  }`}
                >
                  {preset.toLocaleString("ko-KR")}원
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="mt-4 min-h-12 w-full rounded-2xl bg-[#00FFA3] text-base font-extrabold text-[#090A0B] disabled:opacity-60"
            >
              {savingSettings ? "저장 중" : "설정 저장"}
            </button>

            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-sm font-extrabold text-[#D7DDEA]">🧪 시뮬레이터</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    void sendSimulator({
                      userIdHash: REGULAR_HASH,
                      nickname: "후원팬",
                      message: "보스 클리어 축하해",
                      cheeseAmount: 10_000,
                      recentChats: ["보스 클리어!", "ㅋㅋㅋㅋ"],
                      elapsedSec: broadcastElapsedSec(),
                    });
                  }}
                  className="min-h-12 rounded-2xl bg-[#FFB800]/15 px-1 text-xs font-extrabold text-[#FFB800] disabled:opacity-60"
                >
                  고액 1만 치즈
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    void sendSimulator({
                      userIdHash: `user_new_${crypto.randomUUID()}`,
                      nickname: "새시청자",
                      message: "처음 후원해요",
                      cheeseAmount: 1_000,
                      recentChats: ["안녕"],
                      elapsedSec: broadcastElapsedSec(),
                    });
                  }}
                  className="min-h-12 rounded-2xl bg-[#00FFA3]/10 px-1 text-xs font-extrabold text-[#00FFA3] disabled:opacity-60"
                >
                  소액 1천 치즈
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    void sendSimulator({
                      userIdHash: "anonymous",
                      nickname: ANONYMOUS_NICKNAME,
                      message: "응원합니다",
                      cheeseAmount: 10_000,
                      recentChats: ["조용하다"],
                      elapsedSec: broadcastElapsedSec(),
                    });
                  }}
                  className="min-h-12 rounded-2xl border border-white/10 bg-[#0E0F11] px-1 text-xs font-extrabold text-white disabled:opacity-60"
                >
                  익명 1만 치즈
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    void sendRadarTest();
                  }}
                  className="min-h-12 rounded-2xl border border-[#FF5C5C]/40 bg-[#FF5C5C]/10 px-1 text-xs font-extrabold text-[#FFB4B4] disabled:opacity-60"
                >
                  화력 레이더
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <section aria-label="실시간 PD 레이더" className="flex flex-col gap-2">
          {radarCards.length === 0 ? (
            <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-3 text-sm font-bold text-[#8B93A7]">
              레이더 대기 중. 채팅이 조용하면 분석을 부르지 않습니다.
            </p>
          ) : (
            radarCards.map((card) => {
              const banner = radarBannerLabel(card.signal);
              return (
                <article key={card.id} className="rounded-[20px] border border-[#00FFA3]/50 bg-[#16181C] px-4 py-3">
                  <p className="text-sm font-extrabold text-[#00FFA3]">
                    {banner.icon} {card.title}
                  </p>
                  <p className="mt-1 text-lg font-bold leading-snug text-white">{card.summary}</p>
                </article>
              );
            })
          )}
        </section>

        <section aria-label="편집 마커" className="rounded-[22px] border border-white/10 bg-[#16181C] px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">편집 마커</h2>
            <button
              type="button"
              onClick={() => {
                void copyTimeline();
              }}
              disabled={markers.length === 0}
              className="min-h-10 rounded-full bg-[#00FFA3] px-3 text-xs font-extrabold text-[#090A0B] disabled:opacity-40"
            >
              📋 편집자용 타임라인 복사
            </button>
          </div>
          {markers.length === 0 ? (
            <p className="mt-3 text-sm font-semibold leading-6 text-[#8B93A7]">
              화력이 터지거나 1만 치즈 이상 후원이 오면 시각이 여기 쌓입니다.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {markers.map((marker) => (
                <li key={marker.id} className="text-sm font-bold leading-6 text-white">
                  <span className="text-[#FFB800]">{marker.formattedTime}</span>
                  <span className="text-[#8B93A7]"> - </span>
                  {marker.reason}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="후원 요약" className="flex flex-col gap-2">
          <h2 className="px-1 text-base font-extrabold">후원 요약</h2>
          {donations.length === 0 ? (
            <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-6 text-base font-semibold leading-7 text-[#C4CAD8]">
              아직 올라온 후원이 없습니다. 금액과 한 줄 요약만 여기에 뜹니다.
            </p>
          ) : (
            donations.map((card) => (
              <article
                key={card.id}
                className={`rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-3 ${
                  isDonationFaded(card, nowMs) ? "opacity-40" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-extrabold text-[#FFB800]">{card.title}</p>
                  <button
                    type="button"
                    aria-label={card.isPinned ? "고정 해제" : "고정"}
                    aria-pressed={card.isPinned}
                    onClick={() => {
                      void togglePin(card);
                    }}
                    className={`min-h-8 min-w-8 shrink-0 rounded-xl text-sm ${
                      card.isPinned ? "bg-[#FFB800]/15" : "bg-[#0E0F11]"
                    }`}
                  >
                    📌
                  </button>
                </div>
                <p className="mt-2 text-lg font-bold leading-snug text-white">{card.summary}</p>
              </article>
            ))
          )}
        </section>
      </main>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#00FFA3] px-5 py-3 text-base font-extrabold text-[#090A0B]"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
