import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { readSupabasePublicEnv } from "@/lib/supabase/env";

/** 라우트 핸들러에서 로그인 쿠키로 Supabase 유저를 확인한다. */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const env = readSupabasePublicEnv();
  if (!env) {
    return null;
  }

  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트 렌더에서는 쿠키를 못 쓴다. 세션 갱신은 proxy.ts 가 맡는다.
        }
      },
    },
  });
}
