"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PdFeed } from "@/components/pd-feed";
import { useStudio } from "@/components/DashboardLayout";
import { isBriefingCard, isBriefingCardList, isHighlightMarkerList, isRadarVisible, type BriefingCard, type HighlightMarkerCard } from "@/lib/briefing-card";
import { isSeoulToday, seoulSessionDate } from "@/lib/broadcast-time";

const POLL_MS = 2_000;

export default function HomePage() {
  const router = useRouter();
  const studio = useStudio();
  const [cards, setCards] = useState<BriefingCard[]>([]);
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);
  const applyCards = useCallback((nextCards: BriefingCard[]) => {
    setCards(nextCards);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function loadBoard(): Promise<void> {
      if (inFlight) {
        return;
      }
      inFlight = true;
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
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "연결 실패";
        console.error(`[대시보드] ${message}`);
      } finally {
        inFlight = false;
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

  async function togglePin(card: BriefingCard): Promise<void> {
    const response = await fetch(`/api/briefings/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !card.isPinned }),
    });
    if (!response.ok) {
      studio.notify("고정을 바꾸지 못했습니다.");
      return;
    }
    const payload: unknown = await response.json();
    if (isBriefingCard(payload)) {
      setCards((current) => current.map((item) => (item.id === payload.id ? payload : item)));
    }
  }

  const today = studio.nowMs === 0 ? "" : seoulSessionDate(new Date(studio.nowMs));
  const todayCards = cards.filter((card) => isSeoulToday(card.createdAt, studio.nowMs));
  const todayCheese = todayCards
    .filter((card) => card.type === "DONATION")
    .reduce((sum, card) => sum + (card.cheeseAmount ?? 0), 0);
  const radarActive = cards.some((card) => isRadarVisible(card, studio.nowMs));
  const todayMarkers = markers.filter((marker) => marker.sessionDate === today);
  const recentMarkers = [...markers].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <p className="text-xs font-bold text-[#8B93A7]">PD 레이더 상태</p>
          <p className={`mt-2 text-xl font-extrabold ${radarActive ? "text-[#00FFA3]" : "text-white"}`}>
            {radarActive ? "활성 감지 중" : "대기 중"}
          </p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <p className="text-xs font-bold text-[#8B93A7]">오늘 수신 브리핑</p>
          <p className="mt-2 text-xl font-extrabold">{todayCards.length.toLocaleString("ko-KR")}건</p>
          <p className="mt-1 text-sm font-bold text-[#FFB800]">오늘 누적 {todayCheese.toLocaleString("ko-KR")}치즈</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#16181E] p-4">
          <p className="text-xs font-bold text-[#8B93A7]">자동 기록 하이라이트</p>
          <p className="mt-2 text-xl font-extrabold">{todayMarkers.length.toLocaleString("ko-KR")}개</p>
          <Link href="/timeline" className="mt-1 inline-block text-sm font-bold text-[#00FFA3]">
            타임라인 바로가기
          </Link>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-white/10 bg-[#121418] p-4 lg:col-span-8">
          <h2 className="mb-3 text-base font-extrabold">실시간 후원 핵심 요약</h2>
          <PdFeed
            cards={cards}
            nowMs={studio.nowMs}
            mode="donations"
            surface="studio"
            onPin={(card) => {
              void togglePin(card);
            }}
          />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-4">
          <section className="rounded-2xl border border-white/10 bg-[#121418] p-4">
            <h2 className="mb-3 text-base font-extrabold">실시간 채팅 레이더 경보</h2>
            <PdFeed cards={cards} nowMs={studio.nowMs} mode="radar" surface="studio" compact />
          </section>
          <section className="rounded-2xl border border-white/10 bg-[#121418] p-4">
            <h2 className="text-base font-extrabold">최근 기록된 하이라이트</h2>
            {recentMarkers.length === 0 ? (
              <p className="mt-3 text-sm font-semibold leading-6 text-[#8B93A7]">아직 찍힌 시각이 없습니다.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {recentMarkers.map((marker) => (
                  <li key={marker.id} className="text-sm font-bold leading-6 text-white">
                    <span className="text-[#FFB800]">{marker.formattedTime}</span>
                    <span className="text-[#8B93A7]"> · </span>
                    {marker.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
