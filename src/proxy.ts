import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabasePublicEnv } from "@/lib/supabase/env";

function isPublicBoard(path: string): boolean {
  return (
    path.startsWith("/dock/") ||
    path.startsWith("/share/") ||
    path.startsWith("/api/dock/") ||
    path.startsWith("/api/share/")
  );
}

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

/**
 * 로그인하지 않은 사용자는 대시보드와 API에 들어가지 못한다.
 * Supabase가 갱신한 세션 쿠키는 리다이렉트 응답에도 실어 보낸다.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = readSupabasePublicEnv();
  const path = request.nextUrl.pathname;
  if (isPublicBoard(path)) {
    return response;
  }

  if (!env) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    }
    if (path === "/" || path === "/timeline") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user && (path === "/" || path === "/timeline")) {
    return copyCookies(response, NextResponse.redirect(new URL("/login", request.url)));
  }
  if (!user && path.startsWith("/api/")) {
    const denied = NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    return copyCookies(response, denied);
  }
  if (user && path === "/login") {
    return copyCookies(response, NextResponse.redirect(new URL("/", request.url)));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
