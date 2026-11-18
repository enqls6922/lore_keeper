import { connection } from "next/server";

import { ANONYMOUS_NICKNAME, isAnonymousDonor } from "@/lib/anonymous";
import { requireUser, unauthorizedResponse } from "@/lib/auth/current-user";
import { toBriefingCard, toMarkerCard } from "@/lib/briefing-mapper";
import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { formatBroadcastTime } from "@/lib/broadcast-time";
import { HIGH_CHEESE } from "@/lib/chat-radar";
import { summarizeDonation } from "@/lib/llm/pd";
import { prisma } from "@/lib/prisma";

const MAX_RECENT_CHATS = 40;
const MAX_CHAT_LENGTH = 200;
const MAX_ELAPSED_SEC = 48 * 60 * 60;
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface DonationInput {
  nickname: string;
  message: string;
  cheeseAmount: number;
  recentChats: string[];
  elapsedSec: number;
  isAnonymous: boolean;
}

export interface DonationResponse {
  briefing: BriefingCard | null;
  marker: HighlightMarkerCard | null;
  skipReason: "below-minimum" | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecentChats(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const chats: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LENGTH) {
      continue;
    }
    chats.push(trimmed);
    if (chats.length >= MAX_RECENT_CHATS) {
      break;
    }
  }
  return chats;
}

function readDonation(value: unknown): DonationInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawHash = typeof value.userIdHash === "string" ? value.userIdHash.trim() : "";
  const rawNick = typeof value.nickname === "string" ? value.nickname.trim() : "";
  const anonymous = isAnonymousDonor(rawHash, rawNick);
  if (rawHash.length > 128 || rawNick.length > 40) {
    return null;
  }
  if (!anonymous && rawNick.length === 0) {
    return null;
  }
  if (typeof value.message !== "string" || value.message.length > 500) {
    return null;
  }
  if (
    typeof value.cheeseAmount !== "number" ||
    !Number.isInteger(value.cheeseAmount) ||
    value.cheeseAmount <= 0 ||
    value.cheeseAmount > 1_000_000_000
  ) {
    return null;
  }
  const elapsedSec = value.elapsedSec;
  if (
    typeof elapsedSec !== "number" ||
    !Number.isInteger(elapsedSec) ||
    elapsedSec < 0 ||
    elapsedSec > MAX_ELAPSED_SEC
  ) {
    return null;
  }
  return {
    nickname: anonymous ? ANONYMOUS_NICKNAME : rawNick,
    message: value.message.trim(),
    cheeseAmount: value.cheeseAmount,
    recentChats: readRecentChats(value.recentChats),
    elapsedSec,
    isAnonymous: anonymous,
  };
}

function donationTitle(input: DonationInput): string {
  const amount = input.cheeseAmount.toLocaleString("ko-KR");
  return `${input.nickname} · ${amount} 치즈`;
}

/**
 * 이번 후원의 한 줄만 남긴다. 시청자 누적 행은 만들지 않는다.
 * 1만 치즈 이상은 같은 시각의 편집 마커도 남긴다.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();

  try {
    const input = readDonation(await request.json());
    if (!input) {
      return Response.json(
        { message: "nickname, message, cheeseAmount, elapsedSec가 필요합니다." },
        { status: 400, headers: NO_STORE },
      );
    }

    const user = await requireUser();
    if (!user) {
      return unauthorizedResponse();
    }

    if (input.cheeseAmount < user.minCheeseAmount) {
      const body: DonationResponse = { briefing: null, marker: null, skipReason: "below-minimum" };
      return Response.json(body, { headers: NO_STORE });
    }

    const summary = await summarizeDonation({
      nickname: input.nickname,
      message: input.message,
      cheeseAmount: input.cheeseAmount,
      recentChats: input.recentChats,
      anonymous: input.isAnonymous,
    });
    const briefing = await prisma.briefing.create({
      data: {
        userId: user.id,
        type: "DONATION",
        title: donationTitle(input),
        summary,
        signal: null,
      },
    });
    const marker =
      input.cheeseAmount >= HIGH_CHEESE
        ? await prisma.highlightMarker.create({
            data: {
              userId: user.id,
              timestampSec: input.elapsedSec,
              formattedTime: formatBroadcastTime(input.elapsedSec),
              reason: summary,
            },
          })
        : null;

    const body: DonationResponse = {
      briefing: toBriefingCard(briefing),
      marker: marker ? toMarkerCard(marker) : null,
      skipReason: null,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "후원을 저장하지 못했습니다.";
    console.error(`[POST /api/events] ${message}`);
    return Response.json({ message: "후원을 저장하지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
