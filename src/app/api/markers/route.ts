import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toMarkerCard } from "@/lib/briefing-mapper";
import { prisma } from "@/lib/prisma";

const LATEST_LIMIT = 100;
const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 이번 계정의 편집 마커를 방송 시각 순으로 돌려준다. */
export async function GET(): Promise<Response> {
  await connection();

  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const rows = await prisma.highlightMarker.findMany({
      where: { userId: user.id },
      orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }],
      take: LATEST_LIMIT,
    });
    return Response.json(rows.map(toMarkerCard), { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "마커를 불러오지 못했습니다.";
    console.error(`[GET /api/markers] ${message}`);
    return Response.json({ message: "마커를 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
