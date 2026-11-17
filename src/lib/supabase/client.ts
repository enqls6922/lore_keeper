"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readSupabasePublicEnv } from "@/lib/supabase/env";

/** 브라우저에서 로그인 세션 쿠키를 다룬다. 설정이 없으면 null. */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  const env = readSupabasePublicEnv();
  if (!env) {
    return null;
  }
  return createBrowserClient(env.url, env.anonKey);
}
