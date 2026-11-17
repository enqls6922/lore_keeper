import { PrismaClient } from "@prisma/client";

/**
 * User 테이블이 아직 없으면 이전 Viewer·Briefing·ChatLog를 지운다.
 * 회원 스키마로 바꾸는 첫 배포에서만 기존 데이터를 비우고, 이후 배포는 그대로 둔다.
 */
async function main(): Promise<void> {
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prepare-auth-schema] ${message}`);
  process.exit(1);
});
