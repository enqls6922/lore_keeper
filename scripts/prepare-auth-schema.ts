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
  await alignBoardTables();
  execFileSync("prisma", ["db", "push", "--accept-data-loss"], { stdio: "inherit" });
}

/** 예전 칸이 남아 있으면 그 표만 지우고, 이미 맞는 누적 치즈는 남긴다. */
async function alignBoardTables(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('Viewer', 'Briefing', 'HighlightMarker')
    `;
    const has = (table: string, column: string): boolean =>
      columns.some((row) => row.table_name === table && row.column_name === column);
    const hasTable = (table: string): boolean => columns.some((row) => row.table_name === table);
    if (hasTable("Viewer") && !has("Viewer", "chzzkUserIdHash")) {
      await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Viewer" CASCADE');
    }
    if (hasTable("Briefing") && !has("Briefing", "category")) {
      await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Briefing" CASCADE');
    }
    if (hasTable("HighlightMarker") && !has("HighlightMarker", "sessionDate")) {
      await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "HighlightMarker" CASCADE');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prepare-auth-schema] ${message}`);
  process.exit(1);
});
