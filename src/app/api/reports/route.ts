import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { toReportCard } from "@/lib/stream-report";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 저장해 둔 회차 패키지를 최신 방송일부터 돌려준다. */
export async function GET(): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }
  try {
    const rows = await prisma.streamReport.findMany({
      where: { userId: user.id },
      orderBy: { sessionDate: "desc" },
      take: 60,
    });
    return Response.json(
      rows.flatMap((row) => {
        const card = toReportCard(row);
        return card ? [card] : [];
      }),
      { headers: NO_STORE },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "패키지를 불러오지 못했습니다.";
    console.error(`[GET /api/reports] ${message}`);
    return Response.json({ message: "패키지를 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
