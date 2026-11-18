import { connection } from "next/server";

import { boardForObsToken, isShareToken } from "@/lib/public-board";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** OBS 브라우저 독. 로그인 없이 obsToken으로 레이더와 후원만 본다. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  await connection();
  const { token } = await params;
  if (!isShareToken(token)) {
    return Response.json({ message: "독 주소를 확인해 주세요." }, { status: 404, headers: NO_STORE });
  }
  try {
    const board = await boardForObsToken(token.trim());
    if (!board) {
      return Response.json({ message: "독 주소를 확인해 주세요." }, { status: 404, headers: NO_STORE });
    }
    return Response.json(board, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "독 화면을 불러오지 못했습니다.";
    console.error(`[GET /api/dock] ${message}`);
    return Response.json({ message: "독 화면을 불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
