"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useStudio } from "@/components/DashboardLayout";
import { TimelineList, timelineText } from "@/components/timeline-list";
import { isHighlightMarkerList, type HighlightMarkerCard } from "@/lib/briefing-card";

export default function TimelinePage() {
  const router = useRouter();
  const studio = useStudio();
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <button
        type="button"
        onClick={() => {
          void copyAll();
        }}
        disabled={markers.length === 0}
        className="w-fit rounded-full bg-[#00FFA3] px-4 py-2 text-sm font-extrabold text-[#090A0B] disabled:opacity-40"
      >
        📋 편집자용 타임라인 텍스트 복사
      </button>
      <TimelineList markers={markers} surface="studio" onDelete={(marker) => void removeMarker(marker)} />
    </div>
  );
}
