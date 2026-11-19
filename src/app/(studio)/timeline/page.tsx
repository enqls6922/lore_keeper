"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PackagingView } from "@/components/packaging-view";
import { useStudio } from "@/components/DashboardLayout";
import { TimelineList, sessionHeading, timelineText } from "@/components/timeline-list";
import { isHighlightMarkerList, type HighlightMarkerCard } from "@/lib/briefing-card";
import { seoulSessionDate } from "@/lib/broadcast-time";
import { isStreamReportCard, isStreamReportList, type StreamReportCard } from "@/lib/stream-report";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default function TimelinePage() {
  const router = useRouter();
  const studio = useStudio();
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);
  const [reports, setReports] = useState<StreamReportCard[]>([]);
  const [sessionDate, setSessionDate] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const [markerResponse, reportResponse] = await Promise.all([
        fetch("/api/markers", { cache: "no-store" }),
        fetch("/api/reports", { cache: "no-store" }),
      ]);
      if (markerResponse.status === 401 || reportResponse.status === 401) {
        router.push("/login");
        return;
      }
      const markerPayload: unknown = await markerResponse.json().catch(() => null);
      const reportPayload: unknown = await reportResponse.json().catch(() => null);
      if (!cancelled && markerResponse.ok && isHighlightMarkerList(markerPayload)) {
        setMarkers(markerPayload);
      }
      if (!cancelled && reportResponse.ok && isStreamReportList(reportPayload)) {
        setReports(reportPayload);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const marker of markers) {
      set.add(marker.sessionDate);
    }
    for (const report of reports) {
      set.add(report.sessionDate);
    }
    if (studio.nowMs > 0) {
      set.add(seoulSessionDate(new Date(studio.nowMs)));
    }
    return [...set].sort((left, right) => right.localeCompare(left));
  }, [markers, reports, studio.nowMs]);

  const activeDate = dates.includes(sessionDate) ? sessionDate : (dates[0] ?? "");
  const visibleMarkers = markers.filter((marker) => marker.sessionDate === activeDate);
  const report = reports.find((item) => item.sessionDate === activeDate) ?? null;

  async function copyAll(): Promise<void> {
    const text = timelineText(visibleMarkers);
    if (text.length === 0) {
      studio.notify("복사할 마커가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      studio.notify("복사하지 못했습니다.");
      return;
    }
    studio.notify("편집 타임라인을 복사했습니다.");
  }

  async function removeMarker(marker: HighlightMarkerCard): Promise<void> {
    const response = await fetch(`/api/markers/${marker.id}`, { method: "DELETE" });
    if (!response.ok) {
      studio.notify("마커를 지우지 못했습니다.");
      return;
    }
    setMarkers((current) => current.filter((item) => item.id !== marker.id));
  }

  async function generate(): Promise<void> {
    if (generating || activeDate.length === 0) {
      return;
    }
    setGenerating(true);
    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionDate: activeDate }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isStreamReportCard(payload)) {
        const message = isRecord(payload) && typeof payload.message === "string" ? payload.message : "패키지를 만들지 못했습니다.";
        studio.notify(message);
        return;
      }
      setReports((current) => [payload, ...current.filter((item) => item.sessionDate !== payload.sessionDate)]);
      studio.notify("AI 패키지를 만들었습니다.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "패키지 생성 실패";
      console.error(`[패키징] ${message}`);
      studio.notify("패키지를 만들지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <section className="flex flex-col gap-4 xl:col-span-5">
        <div className="flex flex-wrap gap-2">
          {dates.map((date) => (
            <button
              key={date}
              type="button"
              aria-pressed={date === activeDate}
              onClick={() => {
                setSessionDate(date);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${
                date === activeDate ? "bg-[#00FFA3] text-[#090A0B]" : "border border-white/10 text-[#D7DDEA]"
              }`}
            >
              {sessionHeading(date)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            void copyAll();
          }}
          disabled={visibleMarkers.length === 0}
          className="w-fit rounded-full bg-[#00FFA3] px-4 py-2 text-sm font-extrabold text-[#090A0B] disabled:opacity-40"
        >
          📋 편집자용 타임라인 텍스트 복사
        </button>
        <TimelineList markers={visibleMarkers} surface="studio" onDelete={(marker) => void removeMarker(marker)} />
      </section>
      <section className="flex flex-col gap-4 xl:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">{activeDate ? `${sessionHeading(activeDate)} 패키징` : "패키징"}</h2>
          <button
            type="button"
            disabled={generating || activeDate.length === 0}
            onClick={() => {
              void generate();
            }}
            className="rounded-full bg-[#FFB800] px-4 py-2 text-sm font-extrabold text-[#090A0B] disabled:opacity-50"
          >
            {generating ? "만드는 중" : "✨ AI 유튜브 · 공지 패키징 생성"}
          </button>
        </div>
        {report ? (
          <PackagingView report={report} surface="studio" onCopy={studio.notify} />
        ) : (
          <p className="rounded-2xl border border-white/10 bg-[#16181E] px-4 py-6 text-sm font-semibold leading-6 text-[#8B93A7]">
            이 회차의 패키지가 없습니다. 하이라이트나 브리핑이 있으면 위 버튼으로 유튜브 챕터, 쇼츠 3개, 팬카페 공지를 만듭니다.
          </p>
        )}
      </section>
    </div>
  );
}
