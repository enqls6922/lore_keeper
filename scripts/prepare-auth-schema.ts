import "dotenv/config";
import { execFileSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

/**
 * 데이터베이스 주소가 있으면 스키마를 반영한다.
 * User 테이블이 아직 없으면 이전 Viewer·Briefing·ChatLog를 지운 뒤 반영한다.
 * 주소가 없는 미리보기 빌드는 스키마 반영을 건너뛰고 컴파일만 한다.
 */
async function dropLegacyTables(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'User'
      ) AS "exists"
    `;
    if (rows[0]?.exists) {
      return;
    }

    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "ChatLog" CASCADE');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Briefing" CASCADE');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Viewer" CASCADE');
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim() || !process.env.DIRECT_URL?.trim()) {
    console.log("[prepare-auth-schema] DATABASE_URL 또는 DIRECT_URL이 없어 스키마 반영을 건너뜁니다.");
    return;
  }

  await dropLegacyTables();
  execFileSync("prisma", ["db", "push", "--accept-data-loss"], { stdio: "inherit" });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prepare-auth-schema] ${message}`);
  process.exit(1);
});
