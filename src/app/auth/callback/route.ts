import { connection, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 브라우저가 실제로 연 주소로 되돌린다. 개발 서버의 바인드 주소로 새지 않게 한다. */
function redirectTo(request: Request, pathname: string): NextResponse {
  const current = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    current.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : current.origin;
  return NextResponse.redirect(new URL(pathname, origin));
}

/** Google이 돌려준 인가 코드를 세션 쿠키로 바꾼 뒤 대시보드로 보낸다. */
export async function GET(request: Request): Promise<NextResponse> {
  await connection();
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  if (code.length === 0 || url.searchParams.has("error")) {
    return redirectTo(request, "/login?error=google");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return redirectTo(request, "/login?error=google");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectTo(request, "/login?error=google");
  }

  return redirectTo(request, "/");
}
