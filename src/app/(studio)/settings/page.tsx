"use client";

import { useState } from "react";

import { useStudio } from "@/components/DashboardLayout";
import { ANONYMOUS_NICKNAME } from "@/lib/anonymous";
import { broadcastElapsedSec } from "@/lib/broadcast-time";
import { CHEESE_PRESETS } from "@/lib/stream-settings";

const REGULAR_HASH = "user_regular_demo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default function SettingsPage() {
  const studio = useStudio();
  const [sending, setSending] = useState(false);

  async function sendSimulator(body: Record<string, unknown>, emptyMessage: string): Promise<void> {
    if (sending) {
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string" ? payload.message : emptyMessage;
        studio.notify(message);
        return;
      }
      if (isRecord(payload) && payload.briefing === null && payload.skipReason === "below-minimum") {
        studio.notify("최소 치즈보다 작아 올리지 않았습니다.");
        return;
      }
      studio.notify("테스트 후원을 상황판에 올렸습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : emptyMessage;
      console.error(`[시뮬레이터] ${message}`);
      studio.notify(emptyMessage);
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
          triggers: ["SPIKE"],
          elapsedSec: broadcastElapsedSec(),
          messages: Array.from({ length: 15 }, (_, index) => (index === 14 ? "보스 클리어 축하해" : `채팅 ${index}`)),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload) || !Array.isArray(payload.briefings)) {
        studio.notify("레이더 테스트를 보내지 못했습니다.");
        return;
      }
      studio.notify("화력 레이더를 상황판에 올렸습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "레이더 테스트 실패";
      console.error(`[레이더] ${message}`);
      studio.notify("레이더 테스트를 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <form
        className="rounded-2xl border border-white/10 bg-[#16181E] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void studio.saveSettings();
        }}
      >
        <h2 className="text-lg font-extrabold">방송 연결</h2>
        <label className="mt-4 block text-sm font-bold text-[#AEB6C9]" htmlFor="channel-id">
          치지직 채널 ID
          <input
            id="channel-id"
            value={studio.channelId}
            onChange={(event) => {
              studio.setChannelId(event.target.value);
            }}
            placeholder="채널 ID"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-[#6E768A]"
          />
        </label>
        <p className="mt-5 text-sm font-bold text-[#AEB6C9]">최소 브리핑 치즈 금액</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHEESE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={studio.minCheeseAmount === preset}
              onClick={() => {
                studio.setMinCheeseAmount(preset);
              }}
              className={`rounded-xl px-3 py-3 text-sm font-extrabold ${
                studio.minCheeseAmount === preset
                  ? "bg-[#00FFA3] text-[#090A0B]"
                  : "border border-white/10 bg-[#0B0C0E] text-[#D7DDEA]"
              }`}
            >
              {preset.toLocaleString("ko-KR")}치즈
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={studio.savingSettings}
          className="mt-5 rounded-full bg-[#00FFA3] px-4 py-2 text-sm font-extrabold text-[#090A0B] disabled:opacity-60"
        >
          {studio.savingSettings ? "저장 중" : "설정 저장"}
        </button>
      </form>

      <section className="rounded-2xl border border-white/10 bg-[#16181E] p-5">
        <h2 className="text-lg font-extrabold">테스트 시뮬레이터</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#8B93A7]">
          방송 화면에는 올리지 않습니다. 누른 결과는 실시간 상황판에서 확인합니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendSimulator(
                {
                  userIdHash: REGULAR_HASH,
                  nickname: "후원팬",
                  message: "보스 클리어 축하해",
                  cheeseAmount: 10_000,
                  recentChats: ["보스 클리어!", "ㅋㅋㅋㅋ"],
                  elapsedSec: broadcastElapsedSec(),
                },
                "시뮬레이터 이벤트를 보내지 못했습니다.",
              );
            }}
            className="rounded-xl bg-[#FFB800]/15 px-3 py-3 text-xs font-extrabold text-[#FFB800] disabled:opacity-60"
          >
            고액 1만 치즈
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendSimulator(
                {
                  userIdHash: `user_new_${crypto.randomUUID()}`,
                  nickname: "새시청자",
                  message: "처음 후원해요",
                  cheeseAmount: 1_000,
                  recentChats: ["안녕"],
                  elapsedSec: broadcastElapsedSec(),
                },
                "시뮬레이터 이벤트를 보내지 못했습니다.",
              );
            }}
            className="rounded-xl bg-[#00FFA3]/10 px-3 py-3 text-xs font-extrabold text-[#00FFA3] disabled:opacity-60"
          >
            소액 1천 치즈
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendSimulator(
                {
                  userIdHash: "anonymous",
                  nickname: ANONYMOUS_NICKNAME,
                  message: "응원합니다",
                  cheeseAmount: 10_000,
                  recentChats: ["조용하다"],
                  elapsedSec: broadcastElapsedSec(),
                },
                "시뮬레이터 이벤트를 보내지 못했습니다.",
              );
            }}
            className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-3 text-xs font-extrabold text-white disabled:opacity-60"
          >
            익명 1만 치즈
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              void sendRadarTest();
            }}
            className="rounded-xl border border-[#FF5C5C]/40 bg-[#FF5C5C]/10 px-3 py-3 text-xs font-extrabold text-[#FFB4B4] disabled:opacity-60"
          >
            화력 레이더
          </button>
        </div>
      </section>
    </div>
  );
}
