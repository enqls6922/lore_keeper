"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useChzzkChat } from "@/hooks/useChzzkChat";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { ANONYMOUS_NICKNAME } from "@/lib/anonymous";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  compareBriefingCards,
  isBriefingCard,
  isBriefingCardList,
  type BriefingCard,
} from "@/lib/briefing-card";
import {
  CHEESE_PRESETS,
  DEFAULT_MIN_CHEESE,
  DEFAULT_SPEECH_LEVEL,
  DEFAULT_TONE_TAGS,
  isCheesePreset,
  isLogoutMinutes,
  isSpeechLevel,
  isToneTag,
  LOGOUT_LABELS,
  LOGOUT_PRESETS,
  MAX_STREAM_CONTEXT,
  MAX_STREAM_HABIT,
  SPEECH_LEVELS,
  TONE_TAG_LABELS,
  TONE_TAGS,
  type CheesePreset,
  type LogoutMinutes,
  type SpeechLevel,
  type ToneTag,
} from "@/lib/stream-settings";

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

function loyaltyLabel(card: BriefingCard): string {
  if (card.isAnonymous || !card.viewer) {
    return "익명";
  }
  if (card.viewer.visitCount <= 1) {
    return "첫후원";
  }
  return "단골";
}

function cardName(card: BriefingCard): string {
  return card.isAnonymous || !card.viewer ? ANONYMOUS_NICKNAME : card.viewer.nickname;
}

type SkipReason = "first-chat-off" | "known-viewer" | "below-minimum" | "anonymous-chat";

function readSkipReason(value: unknown): SkipReason | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.skipReason === "first-chat-off" ||
    value.skipReason === "known-viewer" ||
    value.skipReason === "below-minimum" ||
    value.skipReason === "anonymous-chat"
  ) {
    return value.skipReason;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface AccountProfile {
  email: string;
  chzzkChannelId: string | null;
  enableFirstChat: boolean;
  minCheeseAmount: CheesePreset;
  streamSpeechLevel: SpeechLevel;
  streamToneTags: ToneTag[];
  streamHabit: string | null;
  streamContext: string | null;
  autoLogoutMinutes: LogoutMinutes;
}

function isToneTagList(value: unknown): value is ToneTag[] {
  return Array.isArray(value) && value.every(isToneTag);
}

function isAccountProfile(value: unknown): value is AccountProfile {
  if (!isRecord(value) || typeof value.email !== "string") {
    return false;
  }
  const channelOk = value.chzzkChannelId === null || typeof value.chzzkChannelId === "string";
  const habitOk = value.streamHabit === null || typeof value.streamHabit === "string";
  const contextOk = value.streamContext === null || typeof value.streamContext === "string";
  return (
    channelOk &&
    habitOk &&
    contextOk &&
    typeof value.enableFirstChat === "boolean" &&
    isCheesePreset(value.minCheeseAmount) &&
    isSpeechLevel(value.streamSpeechLevel) &&
    isToneTagList(value.streamToneTags) &&
    isLogoutMinutes(value.autoLogoutMinutes)
  );
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enableFirstChat, setEnableFirstChat] = useState(false);
  const [minCheeseAmount, setMinCheeseAmount] = useState<CheesePreset>(DEFAULT_MIN_CHEESE);
  const [speechLevel, setSpeechLevel] = useState<SpeechLevel>(DEFAULT_SPEECH_LEVEL);
  const [toneTags, setToneTags] = useState<ToneTag[]>([...DEFAULT_TONE_TAGS]);
  const [streamHabit, setStreamHabit] = useState("");
  const [streamContext, setStreamContext] = useState("");
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState<LogoutMinutes>(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const polling = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTouched = useRef(false);
  const chat = useChzzkChat(channelId, chatEnabled, enableFirstChat);

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
      setEnableFirstChat(payload.enableFirstChat);
      setMinCheeseAmount(payload.minCheeseAmount);
      setSpeechLevel(payload.streamSpeechLevel);
      setToneTags(payload.streamToneTags);
      setStreamHabit(payload.streamHabit ?? "");
      setStreamContext(payload.streamContext ?? "");
      setAutoLogoutMinutes(payload.autoLogoutMinutes);
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

  function applyProfile(payload: AccountProfile): void {
    setAccountEmail(payload.email);
    setEnableFirstChat(payload.enableFirstChat);
    setMinCheeseAmount(payload.minCheeseAmount);
    setSpeechLevel(payload.streamSpeechLevel);
    setToneTags(payload.streamToneTags);
    setStreamHabit(payload.streamHabit ?? "");
    setStreamContext(payload.streamContext ?? "");
    setAutoLogoutMinutes(payload.autoLogoutMinutes);
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
          enableFirstChat,
          minCheeseAmount,
          streamSpeechLevel: speechLevel,
          streamToneTags: toneTags,
          streamHabit: streamHabit.trim(),
          streamContext: streamContext.trim(),
          autoLogoutMinutes,
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

  async function logout(reason?: "idle"): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push(reason === "idle" ? "/login?reason=idle" : "/login");
    router.refresh();
  }

  useIdleLogout({
    minutes: autoLogoutMinutes,
    paused: chatEnabled || wakeOn,
    onIdle: () => {
      void logout("idle");
    },
  });

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

  async function updateCard(id: string, patch: { isPinned?: boolean; isDone?: boolean }): Promise<void> {
    const response = await fetch(`/api/briefings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      showToast("카드 상태를 바꾸지 못했습니다.");
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
      const skipReason = readSkipReason(payload);
      if (skipReason === "first-chat-off") {
        showToast("첫 채팅 브리핑이 꺼져 있습니다.");
        return;
      }
      if (skipReason === "known-viewer") {
        showToast("이미 등록된 시청자라 첫 채팅은 건너뛰었습니다.");
        return;
      }
      if (skipReason === "below-minimum") {
        showToast("최소 치즈보다 작아 누적만 반영했습니다.");
        return;
      }
      if (skipReason === "anonymous-chat") {
        showToast("익명 채팅은 브리핑하지 않습니다.");
        return;
      }
      showToast("브리핑을 만들지 못했습니다.");
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
  const statusDot = statusLive ? "bg-[#00FFA3]" : statusText.includes("중") ? "bg-[#8B93A7]" : "bg-[#FF5C5C]";

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-[#0E0F11] text-white"
      data-idle-minutes={autoLogoutMinutes}
      data-idle-paused={chatEnabled || wakeOn ? "true" : "false"}
    >
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
        </p>
        {chat.liveTitle ? <p className="mt-1 text-sm font-semibold text-[#AEB6C9]">{chat.liveTitle}</p> : null}
        {chat.errorMessage ? <p className="mt-1 text-sm font-semibold text-[#FFB4B4]">{chat.errorMessage}</p> : null}
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 py-4 pb-36">
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

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-[#AEB6C9]">첫 채팅 브리핑</p>
              <button
                type="button"
                aria-pressed={enableFirstChat}
                onClick={() => {
                  setEnableFirstChat((current) => !current);
                }}
                className={`min-h-12 rounded-full px-4 text-sm font-extrabold ${
                  enableFirstChat ? "bg-[#00FFA3] text-[#090A0B]" : "border border-white/10 bg-[#0E0F11] text-[#D7DDEA]"
                }`}
              >
                {enableFirstChat ? "켜짐" : "꺼짐"}
              </button>
            </div>

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
                  {formatCount(preset)}원
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm font-bold text-[#AEB6C9]">기본 어미</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SPEECH_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={speechLevel === level}
                  onClick={() => {
                    setSpeechLevel(level);
                  }}
                  className={`min-h-12 rounded-full px-4 text-sm font-extrabold ${
                    speechLevel === level
                      ? "bg-[#00FFA3] text-[#090A0B]"
                      : "border border-white/10 bg-[#0E0F11] text-[#D7DDEA]"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm font-bold text-[#AEB6C9]">스타일 조합</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TONE_TAGS.map((tag) => {
                const selected = toneTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setToneTags((current) =>
                        current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
                      );
                    }}
                    className={`min-h-12 rounded-full px-4 text-sm font-extrabold ${
                      selected
                        ? "bg-[#00FFA3] text-[#090A0B]"
                        : "border border-white/10 bg-[#0E0F11] text-[#D7DDEA]"
                    }`}
                  >
                    {TONE_TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block text-sm font-bold text-[#AEB6C9]" htmlFor="stream-habit">
              말투 디테일
              <textarea
                id="stream-habit"
                value={streamHabit}
                maxLength={MAX_STREAM_HABIT}
                onChange={(event) => {
                  setStreamHabit(event.target.value);
                }}
                placeholder={'"~하구만" 어미 사용, 과한 감탄사 자제'}
                rows={2}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-[#0E0F11] px-4 py-3 text-base font-semibold leading-6 text-white outline-none placeholder:text-[#6E768A]"
              />
            </label>

            <p className="mt-4 text-sm font-bold text-[#AEB6C9]">미사용 자동 로그아웃</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {LOGOUT_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={autoLogoutMinutes === minutes}
                  onClick={() => {
                    setAutoLogoutMinutes(minutes);
                  }}
                  className={`min-h-12 rounded-full px-4 text-sm font-extrabold ${
                    autoLogoutMinutes === minutes
                      ? "bg-[#00FFA3] text-[#090A0B]"
                      : "border border-white/10 bg-[#0E0F11] text-[#D7DDEA]"
                  }`}
                >
                  {minutes === 0 ? "끄기(기본)" : LOGOUT_LABELS[minutes]}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-sm font-bold text-[#AEB6C9]" htmlFor="stream-context">
              방송 컨셉 메모
              <textarea
                id="stream-context"
                value={streamContext}
                maxLength={MAX_STREAM_CONTEXT}
                onChange={(event) => {
                  setStreamContext(event.target.value);
                }}
                placeholder="오늘 콘셉트, 호칭, 피하고 싶은 말"
                rows={3}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-[#0E0F11] px-4 py-3 text-base font-semibold leading-6 text-white outline-none placeholder:text-[#6E768A]"
              />
            </label>

            <button
              type="submit"
              disabled={savingSettings}
              className="mt-4 min-h-12 w-full rounded-2xl bg-[#00FFA3] text-base font-extrabold text-[#090A0B] disabled:opacity-60"
            >
              {savingSettings ? "저장 중" : "설정 저장"}
            </button>
          </form>
        ) : null}
        {cards.length === 0 ? (
          <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-5 py-8 text-lg leading-7 text-[#C4CAD8]">
            {pollStatus === "offline"
              ? "브리핑을 불러오지 못했습니다. 잠시 후 다시 시도합니다."
              : "아직 올라온 브리핑이 없습니다. 후원이나 첫 방문이 오면 여기에 뜹니다."}
          </p>
        ) : (
          cards.map((card) => (
            <article
              key={card.id}
              className={`rounded-[22px] border bg-[#16181C] px-3 py-3 ${
                card.isPinned ? "border-[#FFB800]/70" : freshIds.has(card.id) ? "border-[#00FFA3]" : "border-white/10"
              } ${card.isDone ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <p className="truncate text-base font-bold">{cardName(card)}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold ${
                      loyaltyLabel(card) === "단골"
                        ? "bg-[#FFB800]/15 text-[#FFB800]"
                        : loyaltyLabel(card) === "익명"
                          ? "bg-white/10 text-[#D7DDEA]"
                          : "bg-[#00FFA3]/15 text-[#00FFA3]"
                    }`}
                  >
                    {loyaltyLabel(card)}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-pressed={card.isPinned}
                    onClick={() => {
                      void updateCard(card.id, { isPinned: !card.isPinned });
                    }}
                    className={`min-h-10 rounded-xl px-2 text-sm font-bold ${
                      card.isPinned ? "bg-[#FFB800]/15 text-[#FFB800]" : "bg-[#0E0F11] text-[#D7DDEA]"
                    }`}
                  >
                    {card.isPinned ? "📌 고정됨" : "📌 고정"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={card.isDone}
                    onClick={() => {
                      void updateCard(card.id, { isDone: !card.isDone });
                    }}
                    className={`min-h-10 rounded-xl px-2 text-sm font-bold ${
                      card.isDone ? "bg-[#00FFA3]/15 text-[#00FFA3]" : "bg-[#0E0F11] text-[#D7DDEA]"
                    }`}
                  >
                    {card.isDone ? "✓ 완료됨" : "✓ 완료"}
                  </button>
                </div>
              </div>
              {card.cheeseAmount > 0 ? (
                <p className="mt-2 text-sm font-extrabold text-[#FFB800]">{formatCount(card.cheeseAmount)}치즈</p>
              ) : null}

              <p className="mt-2 text-lg font-bold leading-snug text-white">{card.summarySnapshot}</p>

              <div className="mt-3 flex flex-col gap-2">
                {card.suggestedReplies.slice(0, 2).map((reply, index) => (
                  <button
                    key={`${card.id}-${index}`}
                    type="button"
                    onClick={() => {
                      void copyReply(reply);
                    }}
                    className="min-h-12 rounded-2xl border border-[#00FFA3]/40 bg-[#00FFA3]/5 px-4 py-3 text-left text-base font-bold leading-6 text-white"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </main>

      <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-white/10 bg-[#0E0F11] px-4 py-3">
        <p className="text-sm font-extrabold text-[#D7DDEA]">🧪 시뮬레이터</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
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
            className="min-h-12 rounded-2xl bg-[#FFB800]/15 px-1 text-xs font-extrabold text-[#FFB800] disabled:opacity-60"
          >
            단골 1만 치즈
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
                recentChats: ["처음 들렀어요"],
              });
            }}
            className="min-h-12 rounded-2xl bg-[#00FFA3]/10 px-1 text-xs font-extrabold text-[#00FFA3] disabled:opacity-60"
          >
            뉴비 첫 채팅
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
              });
            }}
            className="min-h-12 rounded-2xl border border-white/10 bg-[#16181C] px-1 text-xs font-extrabold text-white disabled:opacity-60"
          >
            익명 1만 치즈
          </button>
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#00FFA3] px-5 py-3 text-base font-extrabold text-[#090A0B]"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
