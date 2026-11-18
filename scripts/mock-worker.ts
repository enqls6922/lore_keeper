import "dotenv/config";

import { randomInt } from "node:crypto";

import { HIGH_CHEESE } from "@/lib/chat-radar";
import { summarizeDonation } from "@/lib/llm/pd";
import { prisma } from "@/lib/prisma";
import { formatBroadcastTime } from "@/lib/broadcast-time";

const TICK_MS = 5_000;
const MOCK_USER_ID = "00000000-0000-4000-8000-000000000001";
const startedAt = Date.now();

const MESSAGES = ["보스 클리어 축하해", "작은 응원이야", "이 장면 보고 바로 보냈어", "야식값 대신 치즈 남긴다"] as const;
const AMOUNTS = [1000, 3000, 5000, 10000] as const;

let ticking = false;
let elapsed = 90;

async function simulateOnce(): Promise<void> {
  const message = MESSAGES[randomInt(MESSAGES.length)];
  const cheeseAmount = AMOUNTS[randomInt(AMOUNTS.length)];
  elapsed += 15;

  await prisma.user.upsert({
    where: { id: MOCK_USER_ID },
    create: { id: MOCK_USER_ID, email: "mock@lorekeeper.local" },
    update: {},
  });

  const summary = await summarizeDonation({
    nickname: "후원팬",
    message,
    cheeseAmount,
    recentChats: ["채팅이 잠시 조용하다"],
    anonymous: false,
  });
  await prisma.briefing.create({
    data: {
      userId: MOCK_USER_ID,
      type: "DONATION",
      title: `후원팬 · ${cheeseAmount.toLocaleString("ko-KR")} 치즈`,
      summary,
      signal: null,
    },
  });
  if (cheeseAmount >= HIGH_CHEESE) {
    await prisma.highlightMarker.create({
      data: {
        userId: MOCK_USER_ID,
        timestampSec: elapsed,
        formattedTime: formatBroadcastTime(elapsed),
        reason: summary,
      },
    });
  }
  console.log(`[후원] ${cheeseAmount}치즈 | ${summary} | 경과 ${formatBroadcastTime(Math.floor((Date.now() - startedAt) / 1000))}`);
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

console.log("[시뮬레이터] 5초마다 후원 한 줄 요약을 넣습니다. 시청자 누적은 만들지 않습니다.");
void tick();
setInterval(() => {
  void tick();
}, TICK_MS);
