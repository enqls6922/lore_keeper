import type { User } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** 로그인되지 않았을 때 API가 공통으로 돌려주는 응답. */
export function unauthorizedResponse(): Response {
  return Response.json({ message: "로그인이 필요합니다." }, { status: 401, headers: NO_STORE });
}

/**
 * 현재 Supabase 세션의 사용자를 확인하고, DB에 User가 없으면 만든다.
 * 세션이 없거나 이메일이 없으면 null.
 */
export async function requireUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();
  const authUser = data.user;
  const email = authUser?.email?.trim();
  if (error || !authUser || !email) {
    return null;
  }

  return prisma.user.upsert({
    where: { id: authUser.id },
    create: {
      id: authUser.id,
      email,
    },
    update: {
      email,
    },
  });
}
