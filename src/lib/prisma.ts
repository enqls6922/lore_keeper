import { PrismaClient } from "@prisma/client";

/**
 * 서버리스 함수는 호출마다 모듈을 다시 평가할 수 있다.
 * 그때마다 PrismaClient를 새로 만들면 PostgreSQL 연결이 쌓인다.
 * 프로세스 전역(globalThis)에 인스턴스를 하나만 붙여 두고 재사용한다.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
