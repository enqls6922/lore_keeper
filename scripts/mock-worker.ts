import "dotenv/config";

import { randomInt, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { BriefingTriggerType } from "@/lib/llm/briefing";
import { generateBriefing } from "@/lib/llm/briefing";
import { prisma } from "@/lib/prisma";

const TICK_MS = 5_000;
const MAX_RECENT_CHATS = 15;
const MOCK_USER_ID = "00000000-0000-4000-8000-000000000001";
const recentByHash = new Map<string, string[]>();

interface RegularViewer {
  userIdHash: "user_sky" | "user_gamer" | "user_cat";
  nickname: string;
}

interface SimulatedViewer {
  userIdHash: string;
  nickname: string;
}

const REGULARS: readonly RegularViewer[] = [
  { userIdHash: "user_sky", nickname: "하늘바라기" },
  { userIdHash: "user_gamer", nickname: "겜돌이" },
  { userIdHash: "user_cat", nickname: "냥집사" },
];

const NEW_NICKNAMES = [
  "별빛토끼",
  "야식요정",
  "출근길",
  "달빛수달",
  "팝콘중독",
  "새벽감성",
  "치즈러버",
  "조용한팬",
] as const;

const CHAT_MESSAGES = [
  "오늘 방송 분위기 좋다",
  "방금 장면 진짜 웃겼어",
  "목소리 상태 좋아 보이네",
  "이 이야기 이어서 해 줘",
  "화면 구도 마음에 든다",
  "물 한 잔 하고 와",
] as const;

const CHEESE_MESSAGES = [
  "치즈 보낼게, 오늘도 화이팅",
  "작은 응원이야, 즐겁게 해",
  "이 장면 보고 바로 보냈어",
  "야식값 대신 치즈 남긴다",
] as const;

const CHEESE_AMOUNTS = [1000, 3000, 5000, 10000] as const;

let sequence = 0;
let ticking = false;

function pickViewer(): SimulatedViewer {
  const turn = sequence;
  sequence += 1;

  // 단골 3명과 이번 틱에만 존재하는 신규 시청자를 번갈아 내보낸다.
  if (turn % 2 === 0) {
    const regular = REGULARS[(turn / 2) % REGULARS.length];
    return regular;
  }

  const nickname = NEW_NICKNAMES[randomInt(NEW_NICKNAMES.length)];
  return {
    userIdHash: `user_new_${randomUUID()}`,
    nickname: `${nickname}${randomInt(100, 1000)}`,
  };
}

function rollEvent(): { message: string; cheeseAmount: number } {
  const isCheese = randomInt(100) < 40;
  if (!isCheese) {
    return {
      message: CHAT_MESSAGES[randomInt(CHAT_MESSAGES.length)],
      cheeseAmount: 0,
    };
  }

  return {
    message: CHEESE_MESSAGES[randomInt(CHEESE_MESSAGES.length)],
    cheeseAmount: CHEESE_AMOUNTS[randomInt(CHEESE_AMOUNTS.length)],
  };
}

function readReplies(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function printBriefing(params: {
  nickname: string;
  userIdHash: string;
  triggerType: BriefingTriggerType;
  summary: string;
  suggestedReplies: string[];
  cheeseAmount: number;
  totalCheese: number;
  visitCount: number;
}): void {
  console.log("──────── 브리핑 ────────");
  console.log(`시청자: ${params.nickname} (${params.userIdHash})`);
  console.log(
    `트리거: ${params.triggerType} | 이번 치즈 ${params.cheeseAmount} | 누적 ${params.totalCheese} | 방문 ${params.visitCount}`,
  );
  console.log(`요약: ${params.summary}`);
  console.log("추천 멘트:");
  for (const reply of params.suggestedReplies) {
    console.log(`- ${reply}`);
  }
  console.log("────────────────────────");
}

async function simulateOnce(): Promise<void> {
  const actor = pickViewer();
  const event = rollEvent();
  const now = new Date();

  await prisma.user.upsert({
    where: { id: MOCK_USER_ID },
    create: { id: MOCK_USER_ID, email: "mock@lorekeeper.local" },
    update: {},
  });

  const viewer = await prisma.viewer.upsert({
    where: { userId_userIdHash: { userId: MOCK_USER_ID, userIdHash: actor.userIdHash } },
    create: {
      userId: MOCK_USER_ID,
      userIdHash: actor.userIdHash,
      nickname: actor.nickname,
      totalCheese: event.cheeseAmount,
      visitCount: 1,
      lastSeenAt: now,
    },
    update: {
      nickname: actor.nickname,
      totalCheese: { increment: event.cheeseAmount },
      visitCount: { increment: 1 },
      lastSeenAt: now,
    },
  });

  const recent = recentByHash.get(viewer.userIdHash) ?? [];
  recent.push(event.message);
  if (recent.length > MAX_RECENT_CHATS) {
    recent.splice(0, recent.length - MAX_RECENT_CHATS);
  }
  recentByHash.set(viewer.userIdHash, recent);
  const isFirstChat = viewer.visitCount === 1;

  console.log(
    `[이벤트] ${viewer.nickname} (${viewer.userIdHash}) | 방문 ${viewer.visitCount} | 누적 치즈 ${viewer.totalCheese} | ${event.cheeseAmount > 0 ? `치즈 ${event.cheeseAmount}` : "일반 채팅"} | ${event.message}`,
  );

  // 후원이 있거나, 방금 DB에 처음 등록된 시청자의 첫 채팅일 때만 브리핑한다.
  let triggerType: BriefingTriggerType | null = null;
  if (event.cheeseAmount > 0) {
    triggerType = "CHEESE";
  } else if (isFirstChat) {
    triggerType = "NEW_VIEWER";
  }

  if (!triggerType) {
    return;
  }

  const briefing = await generateBriefing({
    viewer,
    recentChats: (recentByHash.get(viewer.userIdHash) ?? []).map((message) => ({ message })),
    triggerType,
    triggerMessage: event.message,
    cheeseAmount: event.cheeseAmount,
    streamTone: "친근한 반말",
    streamContext: null,
  });

  if (!briefing) {
    console.log("[브리핑] 생성에 실패해서 이번 틱은 이벤트 저장만 마쳤습니다.");
    return;
  }

  printBriefing({
    nickname: viewer.nickname,
    userIdHash: viewer.userIdHash,
    triggerType,
    summary: briefing.summarySnapshot,
    suggestedReplies: readReplies(briefing.suggestedReplies),
    cheeseAmount: briefing.cheeseAmount,
    totalCheese: viewer.totalCheese,
    visitCount: viewer.visitCount,
  });
}

async function tick(): Promise<void> {
  if (ticking) {
    console.log("[시뮬레이터] 이전 틱이 아직 끝나서 이번 주기는 건너뜁니다.");
    return;
  }

  ticking = true;
  try {
    await simulateOnce();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[시뮬레이터] 이벤트 처리에 실패했습니다. ${message}`);
  } finally {
    ticking = false;
  }
}

async function shutdown(): Promise<void> {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

console.log("[시뮬레이터] 5초마다 단골과 신규 시청자 이벤트를 번갈아 넣습니다.");
void tick();
setInterval(() => {
  void tick();
}, TICK_MS);
