import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toBriefingCard } from "@/lib/briefing-mapper";
import { prisma } from "@/lib/prisma";

const LATEST_LIMIT = 30;
const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 최신 후원 요약과 레이더 알림. 폴링이 스냅샷을 받지 않도록 요청 뒤에 조회한다. */
export async function GET(): Promise<Response> {
  await connection();

  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const rows = await prisma.briefing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: LATEST_LIMIT,
    });
    return Response.json(rows.map(toBriefingCard), { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "브리핑을 불러오지 못했습니다.";
    console.error(`[GET /api/briefings] ${message}`);
    return Response.json({ message: "브리핑을 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
