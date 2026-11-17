import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_CHANNEL_ID = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toProfile(user: {
  email: string;
  chzzkChannelId: string | null;
  plan: string;
  aiCredits: number;
}) {
  return {
    email: user.email,
    chzzkChannelId: user.chzzkChannelId,
    plan: user.plan,
    aiCredits: user.aiCredits,
  };
}

/** 로그인한 계정의 이메일, 채널 ID, 요금제, 남은 크레딧을 돌려준다. */
export async function GET(): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }
  return Response.json(toProfile(user), { headers: NO_STORE });
}

/** 내 치지직 채널 ID를 저장한다. 빈 문자열이면 지운다. */
export async function PATCH(request: Request): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.chzzkChannelId !== "string") {
      return Response.json({ message: "채널 ID가 필요합니다." }, { status: 400, headers: NO_STORE });
    }
    const trimmed = body.chzzkChannelId.trim();
    if (trimmed.length > MAX_CHANNEL_ID) {
      return Response.json({ message: "채널 ID가 너무 깁니다." }, { status: 400, headers: NO_STORE });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { chzzkChannelId: trimmed.length === 0 ? null : trimmed },
    });
    return Response.json(toProfile(updated), { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "채널 ID를 저장하지 못했습니다.";
    console.error(`[PATCH /api/user] ${message}`);
    return Response.json({ message: "채널 ID를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
