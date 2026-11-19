import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { seoulDayStart } from "@/lib/broadcast-time";
import { prisma } from "@/lib/prisma";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 오늘 서울 날짜에 만든 브리핑과 패키지 수를 AI 호출로 센다. */
export async function GET(): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }
  try {
    const start = seoulDayStart();
    const [briefings, reports] = await Promise.all([
      prisma.briefing.count({ where: { userId: user.id, createdAt: { gte: start } } }),
      prisma.streamReport.count({ where: { userId: user.id, createdAt: { gte: start } } }),
    ]);
    return Response.json({ todayCalls: briefings + reports, aiCredits: user.aiCredits }, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "사용량을 불러오지 못했습니다.";
    console.error(`[GET /api/usage] ${message}`);
    return Response.json({ message: "사용량을 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
