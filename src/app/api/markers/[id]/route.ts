import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 내 편집 마커 한 건을 지운다. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();

  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const markerId = id.trim();
    if (markerId.length === 0 || markerId.length > 64) {
      return Response.json({ message: "마커 id가 필요합니다." }, { status: 400, headers: NO_STORE });
    }
    const deleted = await prisma.highlightMarker.deleteMany({
      where: { id: markerId, userId: user.id },
    });
    if (deleted.count === 0) {
      return Response.json({ message: "마커를 찾지 못했습니다." }, { status: 404, headers: NO_STORE });
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "마커를 지우지 못했습니다.";
    console.error(`[DELETE /api/markers/[id]] ${message}`);
    return Response.json({ message: "마커를 지우지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
