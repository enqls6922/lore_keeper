"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PdFeed } from "@/components/pd-feed";
import { isBriefingCardList, isHighlightMarkerList, type BriefingCard } from "@/lib/briefing-card";

const POLL_MS = 2_000;
const TOAST_MS = 3_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function DockBoard() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [cards, setCards] = useState<BriefingCard[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const seenMarkers = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

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

  useEffect(() => {
    if (token.length === 0) {
      return;
    }
    let cancelled = false;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    async function load(): Promise<void> {
      const response = await fetch(`/api/dock/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (response.status === 404) {
        if (!cancelled) {
          setMissing(true);
        }
        return;
      }
      if (!response.ok) {
        return;
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isBriefingCardList(payload.briefings) || !isHighlightMarkerList(payload.markers)) {
        return;
      }
      if (cancelled) {
        return;
      }
      setCards(payload.briefings);
      const fresh = payload.markers.filter((marker) => !seenMarkers.current.has(marker.id));
      for (const marker of payload.markers) {
        seenMarkers.current.add(marker.id);
      }
      if (!firstLoad.current && fresh.length > 0) {
        const newest = fresh[0];
        setToast(`⏱️ ${newest.formattedTime} 하이라이트 기록됨`);
        if (toastTimer) {
          clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => setToast(null), TOAST_MS);
      }
      firstLoad.current = false;
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
    };
  }, [token]);

  return (
    <div className="mx-auto min-h-full w-full max-w-[400px] bg-[#0E0F11] px-3 py-3 text-white">
      {missing ? (
        <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-6 text-sm font-bold text-[#FFB4B4]">
          독 주소를 확인해 주세요.
        </p>
      ) : (
        <PdFeed cards={cards} nowMs={nowMs} compact />
      )}
      {toast ? (
        <div
          role="status"
          className="fixed left-1/2 top-3 z-30 w-[min(92vw,360px)] -translate-x-1/2 rounded-full bg-[#00FFA3] px-4 py-2 text-center text-sm font-extrabold text-[#090A0B]"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
