"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { TimelineList, timelineText } from "@/components/timeline-list";
import { isHighlightMarkerList, type HighlightMarkerCard } from "@/lib/briefing-card";

export function ShareBoard() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [markers, setMarkers] = useState<HighlightMarkerCard[]>([]);
  const [missing, setMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (token.length === 0) {
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (response.status === 404) {
        if (!cancelled) {
          setMissing(true);
        }
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
  }, [token]);

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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col gap-4 bg-[#0E0F11] px-4 py-4 text-white">
      <div>
        <p className="text-xs font-bold text-[#8B93A7]">읽기 전용</p>
        <h1 className="text-2xl font-extrabold">편집 타임라인</h1>
      </div>
      {missing ? (
        <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-6 text-sm font-bold text-[#FFB4B4]">
          공유 링크를 확인해 주세요.
        </p>
      ) : (
        <>
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
          <TimelineList markers={markers} />
        </>
      )}
      {toast ? <p className="text-sm font-bold text-[#00FFA3]">{toast}</p> : null}
    </div>
  );
}
