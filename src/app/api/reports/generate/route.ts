import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { fetchChzzkBroadcastContext } from "@/lib/chzzk/session";
import { buildPackaging } from "@/lib/llm/packaging";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { toReportCard } from "@/lib/stream-report";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 한 회차의 마커와 브리핑으로 유튜브·쇼츠·팬카페 패키지를 만들고 저장한다. */
export async function POST(request: Request): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.sessionDate)) {
      return Response.json({ message: "방송 날짜를 확인해 주세요." }, { status: 400, headers: NO_STORE });
    }
    const sessionDate = body.sessionDate;
    const dayStart = new Date(`${sessionDate}T00:00:00+09:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [markers, briefings] = await Promise.all([
      prisma.highlightMarker.findMany({
        where: { userId: user.id, sessionDate },
        orderBy: { elapsedSec: "asc" },
      }),
      prisma.briefing.findMany({
        where: { userId: user.id, createdAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { createdAt: "asc" },
        take: 40,
      }),
    ]);
    if (markers.length === 0 && briefings.length === 0) {
      return Response.json({ message: "이 회차에 기록된 내용이 없습니다." }, { status: 400, headers: NO_STORE });
    }
    const context = user.chzzkChannelId
      ? await fetchChzzkBroadcastContext(user.chzzkChannelId)
      : { title: null, category: null };
    const draft = await buildPackaging({
      sessionDate,
      liveTitle: context.title,
      category: context.category,
      markers: markers.map((marker) => ({
        formattedTime: marker.formattedTime,
        triggerType: marker.triggerType,
        summary: marker.summary,
      })),
      briefings: briefings.map((briefing) => ({
        type: briefing.type,
        category: briefing.category,
        nickname: briefing.nickname,
        cheeseAmount: briefing.cheeseAmount,
        summary: briefing.summary,
      })),
    });
    const saved = await prisma.streamReport.upsert({
      where: { userId_sessionDate: { userId: user.id, sessionDate } },
      create: {
        userId: user.id,
        sessionDate,
        youtubeChapters: draft.youtubeChapters,
        shortsIdeas: draft.shortsIdeas as unknown as Prisma.InputJsonValue,
        fanCafeDigest: draft.fanCafeDigest,
      },
      update: {
        youtubeChapters: draft.youtubeChapters,
        shortsIdeas: draft.shortsIdeas as unknown as Prisma.InputJsonValue,
        fanCafeDigest: draft.fanCafeDigest,
      },
    });
    const card = toReportCard(saved);
    if (!card) {
      return Response.json({ message: "패키지를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
    }
    return Response.json(card, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "패키지를 만들지 못했습니다.";
    console.error(`[POST /api/reports/generate] ${message}`);
    return Response.json({ message: "패키지를 만들지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
