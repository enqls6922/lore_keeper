import { createServerClient } from "@supabase/ssr";
import { connection, NextResponse, type NextRequest } from "next/server";

import { readSupabasePublicEnv } from "@/lib/supabase/env";

interface PendingCookie {
  name: string;
  value: string;
  options: Parameters<NextResponse["cookies"]["set"]>[2];
}

/** 브라우저가 실제로 연 주소로 되돌린다. 개발 서버의 바인드 주소로 새지 않게 한다. */
function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const current = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || current.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : current.origin;
  return NextResponse.redirect(new URL(pathname, origin));
}

function applyCookies(response: NextResponse, cookiesToSet: PendingCookie[]): NextResponse {
  for (const cookie of cookiesToSet) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

/**
 * Google이 돌려준 인가 코드를 세션으로 바꾼다.
 * 세션 쿠키는 리다이렉트 응답에 직접 실어, 첫 이동에서 빠지지 않게 한다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  await connection();
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (code.length === 0 || request.nextUrl.searchParams.has("error")) {
    return redirectTo(request, "/login?error=google");
  }

  const env = readSupabasePublicEnv();
  if (!env) {
    return redirectTo(request, "/login?error=google");
  }

  const jar = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));
  const pending = new Map<string, PendingCookie>();
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          if (cookie.value.length === 0) {
            jar.delete(cookie.name);
          } else {
            jar.set(cookie.name, cookie.value);
          }
          pending.set(cookie.name, cookie);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const response = redirectTo(request, error ? "/login?error=google" : "/");
  return applyCookies(response, [...pending.values()]);
}
