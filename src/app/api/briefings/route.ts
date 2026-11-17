import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { briefingInclude, toBriefingCard } from "@/lib/briefing-mapper";
import { prisma } from "@/lib/prisma";

const LATEST_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 최신 20장. 고정된 카드가 항상 위이고, 같은 그룹 안에서는 최근 생성순이다.
 * 폴링이 빌드 시점 스냅샷을 받지 않도록 요청이 들어온 뒤에 조회한다.
 */
export async function GET(): Promise<Response> {
  await connection();

  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const rows = await prisma.briefing.findMany({
      where: { userId: user.id },
      include: briefingInclude,
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: LATEST_LIMIT,
    });

    return Response.json(rows.map(toBriefingCard), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "브리핑을 불러오지 못했습니다.";
    console.error(`[GET /api/briefings] ${message}`);
    return Response.json(
      { message: "브리핑을 불러오지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** 카드 id를 받아 고정 여부를 뒤집는다. */
export async function PATCH(request: Request): Promise<Response> {
  await connection();

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.id !== "string" || body.id.trim().length === 0) {
      return Response.json({ message: "브리핑 id가 필요합니다." }, { status: 400 });
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const id = body.id.trim();
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.briefing.findFirst({
        where: { id, userId: user.id },
        include: briefingInclude,
      });
      if (!current) {
        return null;
      }
      return tx.briefing.update({
        where: { id },
        data: { isPinned: !current.isPinned },
        include: briefingInclude,
      });
    });

    if (!updated) {
      return Response.json({ message: "브리핑을 찾지 못했습니다." }, { status: 404 });
    }

    return Response.json(toBriefingCard(updated), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "고정을 바꾸지 못했습니다.";
    console.error(`[PATCH /api/briefings] ${message}`);
    return Response.json({ message: "고정을 바꾸지 못했습니다." }, { status: 500 });
  }
}
