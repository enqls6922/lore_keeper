"use client";

import { useEffect, useState } from "react";

import { useStudio } from "@/components/DashboardLayout";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default function BillingPage() {
  const studio = useStudio();
  const credits = studio.account?.aiCredits ?? 0;
  const [todayCalls, setTodayCalls] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!cancelled && response.ok && isRecord(payload) && typeof payload.todayCalls === "number") {
        setTodayCalls(payload.todayCalls);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <article className="rounded-2xl border border-white/10 bg-[#16181E] p-6">
        <p className="inline-flex rounded-full border border-[#FFB800]/40 px-2 py-0.5 text-[10px] font-extrabold text-[#FFB800]">
          BETA
        </p>
        <h2 className="mt-3 text-2xl font-extrabold">베타 무료 이용 중</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#AEB6C9]">
          결제는 아직 열려 있지 않습니다. 베타 동안은 플랜 요금 없이 방송 PD를 쓸 수 있습니다.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-4">
            <p className="text-xs font-bold text-[#8B93A7]">오늘 AI 호출</p>
            <p className="mt-2 text-xl font-extrabold text-white">
              {todayCalls === null ? "확인 중" : `${todayCalls.toLocaleString("ko-KR")}회`}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#8B93A7]">오늘 만든 브리핑과 패키지를 합친 수입니다.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-4">
            <p className="text-xs font-bold text-[#8B93A7]">남은 호출</p>
            <p className="mt-2 text-xl font-extrabold text-[#00FFA3]">{credits.toLocaleString("ko-KR")}회</p>
            <p className="mt-1 text-sm font-semibold text-[#8B93A7]">채팅이 조용하면 레이더는 호출하지 않습니다.</p>
          </div>
        </div>
      </article>
    </div>
  );
}
