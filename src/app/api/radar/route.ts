import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toBriefingCard, toMarkerCard } from "@/lib/briefing-mapper";
import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { radarBannerLabel } from "@/lib/briefing-card";
import { formatBroadcastTime } from "@/lib/broadcast-time";
import { isRadarSignal, type RadarSignal } from "@/lib/chat-radar";
import { summarizeRadar } from "@/lib/llm/pd";
import { prisma } from "@/lib/prisma";

const MAX_MESSAGES = 40;
const MAX_CHAT_LENGTH = 200;
const MAX_ELAPSED_SEC = 48 * 60 * 60;
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface RadarInput {
  signal: RadarSignal;
  messages: string[];
  elapsedSec: number;
}

export interface RadarResponse {
  briefing: BriefingCard | null;
  marker: HighlightMarkerCard | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRadar(value: unknown): RadarInput | null {
  if (!isRecord(value) || !isRadarSignal(value.signal)) {
    return null;
  }
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_MESSAGES) {
    return null;
  }
  const messages: string[] = [];
  for (const item of value.messages) {
    if (typeof item !== "string") {
      return null;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LENGTH) {
      return null;
    }
    messages.push(trimmed);
  }
  if (
    typeof value.elapsedSec !== "number" ||
    !Number.isInteger(value.elapsedSec) ||
    value.elapsedSec < 0 ||
    value.elapsedSec > MAX_ELAPSED_SEC
  ) {
    return null;
  }
  return { signal: value.signal, messages, elapsedSec: value.elapsedSec };
}

function radarTitle(signal: RadarSignal): string {
  return radarBannerLabel(signal).title;
}

/** 조건이 맞은 60초 채팅만 받아 배너와, 화력이면 편집 마커를 만든다. 채팅 원문은 저장하지 않는다. */
export async function POST(request: Request): Promise<Response> {
  await connection();

  try {
    const input = readRadar(await request.json());
    if (!input) {
      return Response.json(
        { message: "signal, messages, elapsedSec가 필요합니다." },
        { status: 400, headers: NO_STORE },
      );
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const draft = await summarizeRadar(input.signal, input.messages);
    const briefing = await prisma.briefing.create({
      data: {
        userId: user.id,
        type: "RADAR",
        title: radarTitle(input.signal),
        summary: draft.summary,
        signal: input.signal,
      },
    });
    const marker =
      input.signal === "SPIKE"
        ? await prisma.highlightMarker.create({
            data: {
              userId: user.id,
              timestampSec: input.elapsedSec,
              formattedTime: formatBroadcastTime(input.elapsedSec),
              reason: draft.reason,
            },
          })
        : null;

    const body: RadarResponse = {
      briefing: toBriefingCard(briefing),
      marker: marker ? toMarkerCard(marker) : null,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "레이더를 저장하지 못했습니다.";
    console.error(`[POST /api/radar] ${message}`);
    return Response.json({ message: "레이더를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
