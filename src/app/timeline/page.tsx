"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TimelineList, timelineText } from "@/components/timeline-list";
import { isHighlightMarkerList, type HighlightMarkerCard } from "@/lib/briefing-card";

export default function TimelinePage() {
  const router = useRouter();
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await fetch("/api/markers", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!cancelled && response.ok && isHighlightMarkerList(payload)) {
        setMarkers(payload);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function copyAll(): Promise<void> {
    const text = timelineText(markers);
    if (text.length === 0) {
      setToast("복사할 마커가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setToast("복사하지 못했습니다.");
      return;
    }
    setToast("편집 타임라인을 복사했습니다.");
  }

  async function removeMarker(marker: HighlightMarkerCard): Promise<void> {
    const response = await fetch(`/api/markers/${marker.id}`, { method: "DELETE" });
    if (!response.ok) {
      setToast("마커를 지우지 못했습니다.");
      return;
    }
    setMarkers((current) => current.filter((item) => item.id !== marker.id));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col gap-4 bg-[#0E0F11] px-4 py-4 text-white">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-[#8B93A7]">LoreKeeper</p>
          <h1 className="text-2xl font-extrabold">편집 타임라인</h1>
        </div>
      </div>
      <nav aria-label="화면 이동" className="grid grid-cols-2 gap-2">
        <Link
          href="/"
          className="flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-[#16181C] text-sm font-extrabold text-white"
        >
          상황판
        </Link>
        <span className="flex min-h-11 items-center justify-center rounded-2xl bg-[#00FFA3] text-sm font-extrabold text-[#090A0B]">
          타임라인
        </span>
      </nav>
      <button
        type="button"
        onClick={() => {
          void copyAll();
        }}
        disabled={markers.length === 0}
        className="min-h-12 rounded-2xl bg-[#00FFA3] text-sm font-extrabold text-[#090A0B] disabled:opacity-40"
      >
        📋 편집자용 타임라인 텍스트 복사
      </button>
      <TimelineList markers={markers} onDelete={(marker) => void removeMarker(marker)} />
      {toast ? <p className="text-sm font-bold text-[#00FFA3]">{toast}</p> : null}
    </div>
  );
}
