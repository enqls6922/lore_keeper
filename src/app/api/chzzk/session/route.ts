import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { fetchChzzkSession } from "@/lib/chzzk/session";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function failureStatus(reason: "not_found" | "offline" | "upstream"): { status: number; message: string } {
  if (reason === "not_found") {
    return { status: 404, message: "채널을 찾지 못했습니다." };
  }
  if (reason === "offline") {
    return { status: 409, message: "방송 중이 아니어서 채팅 채널을 찾지 못했습니다." };
  }
  return { status: 502, message: "치지직 세션을 가져오지 못했습니다." };
}

/** 채널 ID로 채팅 채널, 읽기 토큰, 방송 제목을 반환한다. 브라우저는 치지직에 직접 붙지 않고 이 경로만 호출한다. */
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

  const result = await fetchChzzkSession(channelId);
  if (!result.ok) {
    const failure = failureStatus(result.reason);
    return Response.json({ message: failure.message }, { status: failure.status, headers: NO_STORE });
  }

  return Response.json(result.session, { headers: NO_STORE });
}
