import { connection } from "next/server";

import { isShareToken, markersForShareToken } from "@/lib/public-board";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 편집자 공유 링크. 읽기만 되고 지우거나 고치지 못한다. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  await connection();
  const { token } = await params;
  if (!isShareToken(token)) {
    return Response.json({ message: "공유 링크를 확인해 주세요." }, { status: 404, headers: NO_STORE });
  }
  try {
    const markers = await markersForShareToken(token.trim());
    if (!markers) {
      return Response.json({ message: "공유 링크를 확인해 주세요." }, { status: 404, headers: NO_STORE });
    }
    return Response.json(markers, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "타임라인을 불러오지 못했습니다.";
    console.error(`[GET /api/share] ${message}`);
    return Response.json({ message: "타임라인을 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
