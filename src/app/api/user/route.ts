import { connection } from "next/server";

import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_SPEECH_LEVEL,
  isCheesePreset,
  isLogoutMinutes,
  isSpeechLevel,
  isToneTag,
  MAX_STREAM_CONTEXT,
  MAX_STREAM_HABIT,
  readToneTags,
  type LogoutMinutes,
  type SpeechLevel,
  type ToneTag,
} from "@/lib/stream-settings";

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
  minCheeseAmount: number;
  enableFirstChat: boolean;
  streamSpeechLevel: string;
  streamToneTags: string[];
  streamHabit: string | null;
  streamContext: string | null;
  autoLogoutMinutes: number;
}) {
  const speechLevel: SpeechLevel = isSpeechLevel(user.streamSpeechLevel)
    ? user.streamSpeechLevel
    : DEFAULT_SPEECH_LEVEL;
  const toneTags: ToneTag[] = (user.streamToneTags ?? []).filter(isToneTag);
  const autoLogoutMinutes: LogoutMinutes = isLogoutMinutes(user.autoLogoutMinutes) ? user.autoLogoutMinutes : 0;
  return {
    email: user.email,
    chzzkChannelId: user.chzzkChannelId,
    plan: user.plan,
    aiCredits: user.aiCredits,
    minCheeseAmount: user.minCheeseAmount,
    enableFirstChat: user.enableFirstChat,
    streamSpeechLevel: speechLevel,
    streamToneTags: toneTags,
    streamHabit: user.streamHabit,
    streamContext: user.streamContext,
    autoLogoutMinutes,
  };
}

/** 로그인한 계정의 채널과 방송 설정을 돌려준다. */
export async function GET(): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }
  return Response.json(toProfile(user), { headers: NO_STORE });
}

/** 채널 ID와 방송 설정을 저장한다. 보낸 항목만 바꾼다. */
export async function PATCH(request: Request): Promise<Response> {
  await connection();
  const user = await requireUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return Response.json({ message: "설정 형식이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
    }

    const data: {
      chzzkChannelId?: string | null;
      minCheeseAmount?: number;
      enableFirstChat?: boolean;
      streamSpeechLevel?: string;
      streamTone?: string;
      streamToneTags?: string[];
      streamHabit?: string | null;
      streamContext?: string | null;
      autoLogoutMinutes?: number;
    } = {};

    if ("chzzkChannelId" in body) {
      if (typeof body.chzzkChannelId !== "string") {
        return Response.json({ message: "채널 ID가 필요합니다." }, { status: 400, headers: NO_STORE });
      }
      const trimmed = body.chzzkChannelId.trim();
      if (trimmed.length > MAX_CHANNEL_ID) {
        return Response.json({ message: "채널 ID가 너무 깁니다." }, { status: 400, headers: NO_STORE });
      }
      data.chzzkChannelId = trimmed.length === 0 ? null : trimmed;
    }

    if ("minCheeseAmount" in body) {
      if (!isCheesePreset(body.minCheeseAmount)) {
        return Response.json({ message: "최소 치즈 금액을 다시 골라 주세요." }, { status: 400, headers: NO_STORE });
      }
      data.minCheeseAmount = body.minCheeseAmount;
    }

    if ("enableFirstChat" in body) {
      if (typeof body.enableFirstChat !== "boolean") {
        return Response.json({ message: "첫 채팅 브리핑 설정이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
      }
      data.enableFirstChat = body.enableFirstChat;
    }

    if ("streamSpeechLevel" in body) {
      if (!isSpeechLevel(body.streamSpeechLevel)) {
        return Response.json({ message: "기본 어미를 다시 골라 주세요." }, { status: 400, headers: NO_STORE });
      }
      data.streamSpeechLevel = body.streamSpeechLevel;
      data.streamTone = body.streamSpeechLevel;
    }

    if ("streamToneTags" in body) {
      const tags = readToneTags(body.streamToneTags);
      if (!tags) {
        return Response.json({ message: "스타일 태그를 다시 골라 주세요." }, { status: 400, headers: NO_STORE });
      }
      data.streamToneTags = tags;
    }

    if ("streamHabit" in body) {
      if (body.streamHabit !== null && typeof body.streamHabit !== "string") {
        return Response.json({ message: "말투 디테일 형식이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
      }
      const trimmed = typeof body.streamHabit === "string" ? body.streamHabit.trim() : "";
      if (trimmed.length > MAX_STREAM_HABIT) {
        return Response.json({ message: "말투 디테일이 너무 깁니다." }, { status: 400, headers: NO_STORE });
      }
      data.streamHabit = trimmed.length === 0 ? null : trimmed;
    }

    if ("autoLogoutMinutes" in body) {
      if (!isLogoutMinutes(body.autoLogoutMinutes)) {
        return Response.json({ message: "자동 로그아웃 시간을 다시 골라 주세요." }, { status: 400, headers: NO_STORE });
      }
      data.autoLogoutMinutes = body.autoLogoutMinutes;
    }

    if ("streamContext" in body) {
      if (body.streamContext !== null && typeof body.streamContext !== "string") {
        return Response.json({ message: "방송 컨셉 메모 형식이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
      }
      const trimmed = typeof body.streamContext === "string" ? body.streamContext.trim() : "";
      if (trimmed.length > MAX_STREAM_CONTEXT) {
        return Response.json({ message: "방송 컨셉 메모가 너무 깁니다." }, { status: 400, headers: NO_STORE });
      }
      data.streamContext = trimmed.length === 0 ? null : trimmed;
    }

    if (Object.keys(data).length === 0) {
      return Response.json({ message: "저장할 설정이 없습니다." }, { status: 400, headers: NO_STORE });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });
    return Response.json(toProfile(updated), { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "설정을 저장하지 못했습니다.";
    console.error(`[PATCH /api/user] ${message}`);
    return Response.json({ message: "설정을 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
