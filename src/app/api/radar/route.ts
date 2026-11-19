import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toBriefingCard, toMarkerCard } from "@/lib/briefing-mapper";
import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { formatBroadcastTime, seoulSessionDate } from "@/lib/broadcast-time";
import { isRadarTrigger, prepareRadarMessages, type RadarTrigger } from "@/lib/chat-radar";
import { coachingSummary, judgeIssue, summarizeSpike } from "@/lib/llm/pd";
import { prisma } from "@/lib/prisma";

const MAX_MESSAGES = 1_000;
const MAX_CHAT_LENGTH = 200;
const MAX_ELAPSED_SEC = 48 * 60 * 60;
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface RadarInput {
  triggers: RadarTrigger[];
  messages: string[];
  elapsedSec: number;
}

export interface RadarResponse {
  briefings: BriefingCard[];
  markers: HighlightMarkerCard[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRadar(value: unknown): RadarInput | null {
  if (!isRecord(value) || !Array.isArray(value.triggers) || value.triggers.length === 0) {
    return null;
  }
  const triggers: RadarTrigger[] = [];
  for (const item of value.triggers) {
    if (!isRadarTrigger(item) || triggers.includes(item)) {
      return null;
    }
    triggers.push(item);
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
  return { triggers, messages, elapsedSec: value.elapsedSec };
}

/** 조건이 맞은 채팅만 받아 배너와, 화력이면 편집 마커를 만든다. 원문은 저장하지 않는다. */
export async function POST(request: Request): Promise<Response> {
  await connection();

  try {
    const input = readRadar(await request.json());
    if (!input) {
      return Response.json(
        { message: "triggers, messages, elapsedSec가 필요합니다." },
        { status: 400, headers: NO_STORE },
      );
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const briefings: BriefingCard[] = [];
    const markers: HighlightMarkerCard[] = [];

    const prepared = prepareRadarMessages(input.messages);

    if (input.triggers.includes("SPIKE") && prepared.length > 0) {
      const summary = await summarizeSpike(prepared);
      const briefing = await prisma.briefing.create({
        data: {
          userId: user.id,
          type: "RADAR",
          category: "MOOD",
          summary,
        },
      });
      const marker = await prisma.highlightMarker.create({
        data: {
          userId: user.id,
          sessionDate: seoulSessionDate(),
          elapsedSec: input.elapsedSec,
          formattedTime: formatBroadcastTime(input.elapsedSec),
          triggerType: "CHAT_SPIKE",
          summary,
        },
      });
      briefings.push(toBriefingCard(briefing));
      markers.push(toMarkerCard(marker));
    }

    if (input.triggers.includes("ISSUE") && prepared.length > 0) {
      const judgement = await judgeIssue(prepared);
      if (judgement.shouldAlert) {
        const briefing = await prisma.briefing.create({
          data: {
            userId: user.id,
            type: "RADAR",
            category: judgement.category,
            summary: judgement.summary,
          },
        });
        briefings.push(toBriefingCard(briefing));
      }
    }

    if (input.triggers.includes("COACHING")) {
      const briefing = await prisma.briefing.create({
        data: {
          userId: user.id,
          type: "RADAR",
          category: "MOOD",
          summary: coachingSummary(),
        },
      });
      briefings.push(toBriefingCard(briefing));
    }

    const body: RadarResponse = { briefings, markers };
    return Response.json(body, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "레이더를 저장하지 못했습니다.";
    console.error(`[POST /api/radar] ${message}`);
    return Response.json({ message: "레이더를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
