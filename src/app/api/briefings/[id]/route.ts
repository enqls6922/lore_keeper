import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toBriefingCard } from "@/lib/briefing-mapper";
import { prisma } from "@/lib/prisma";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 후원 카드의 고정만 바꾼다. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();

  try {
    const { id } = await params;
    const briefingId = id.trim();
    if (briefingId.length === 0 || briefingId.length > 64) {
      return Response.json({ message: "브리핑 id가 필요합니다." }, { status: 400, headers: NO_STORE });
    }

    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.isPinned !== "boolean") {
      return Response.json({ message: "고정 상태가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const updated = await prisma.briefing.updateMany({
      where: { id: briefingId, userId: user.id },
      data: { isPinned: body.isPinned },
    });
    if (updated.count === 0) {
      return Response.json({ message: "브리핑을 찾지 못했습니다." }, { status: 404, headers: NO_STORE });
    }

    const row = await prisma.briefing.findFirst({
      where: { id: briefingId, userId: user.id },
    });
    if (!row) {
      return Response.json({ message: "브리핑을 찾지 못했습니다." }, { status: 404, headers: NO_STORE });
    }
    return Response.json(toBriefingCard(row), { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "브리핑 상태를 바꾸지 못했습니다.";
    console.error(`[PATCH /api/briefings/[id]] ${message}`);
    return Response.json({ message: "브리핑 상태를 바꾸지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
