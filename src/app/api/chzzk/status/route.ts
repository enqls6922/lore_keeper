import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { fetchChzzkLiveClock } from "@/lib/chzzk/session";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 생방송이면 치지직 openDate를, 아니면 동기화 없음을 돌려준다. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const channelId = new URL(request.url).searchParams.get("channelId")?.trim() ?? "";
  if (channelId.length === 0 || channelId.length > 64) {
    return Response.json({ message: "채널 ID가 필요합니다." }, { status: 400, headers: NO_STORE });
  }

  try {
    const clock = await fetchChzzkLiveClock(channelId);
    return Response.json(clock, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "방송 상태를 확인하지 못했습니다.";
    console.error(`[GET /api/chzzk/status] ${message}`);
    return Response.json(
      { synced: false, openDateMs: null, liveTitle: null },
      { headers: NO_STORE },
    );
  }
}
