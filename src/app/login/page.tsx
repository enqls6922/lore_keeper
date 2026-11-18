"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

function subscribeToLocation(): () => void {
  return () => undefined;
}

function hasSearchFlag(name: string, expected: string): boolean {
  return new URLSearchParams(window.location.search).get(name) === expected;
}

function useSearchFlag(name: string, expected: string): boolean {
  return useSyncExternalStore(
    subscribeToLocation,
    () => hasSearchFlag(name, expected),
    () => false,
  );
}

function koreanAuthError(message: string, mode: AuthMode): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login") || text.includes("invalid credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "이미 가입된 이메일입니다. 로그인해 주세요.";
  }
  if (text.includes("password")) {
    return "비밀번호는 6자 이상으로 입력해 주세요.";
  }
  return mode === "signup" ? "회원가입에 실패했습니다." : "로그인에 실패했습니다.";
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-5 w-5 shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const googleFailed = useSearchFlag("error", "google");
  const idleNotice = useSearchFlag("reason", "idle");
  const shownError =
    errorMessage ?? (googleFailed ? "Google 로그인에 실패했습니다. 다시 시도해 주세요." : null);

  async function continueWithGoogle(): Promise<void> {
    if (submitting || googleSubmitting) {
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setNotice(null);
      setErrorMessage("Supabase 설정이 없어 로그인할 수 없습니다.");
      return;
    }

    setGoogleSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMessage("Google 로그인에 실패했습니다. 다시 시도해 주세요.");
      setGoogleSubmitting(false);
    }
  }

  async function submit(): Promise<void> {
    if (submitting || googleSubmitting) {
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@") || password.length < 6) {
      setNotice(null);
      setErrorMessage("이메일과 6자 이상 비밀번호를 입력해 주세요.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setNotice(null);
      setErrorMessage("Supabase 설정이 없어 로그인할 수 없습니다.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorMessage(koreanAuthError(error.message, mode));
          return;
        }
        if (!data.session) {
          setNotice("가입 메일을 확인한 뒤 로그인해 주세요.");
          setMode("login");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorMessage(koreanAuthError(error.message, mode));
          return;
        }
      }
      router.replace("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[430px] flex-col justify-center bg-black px-4 py-10 text-white">
      {idleNotice ? (
        <p
          role="status"
          className="mb-4 rounded-2xl border border-[#00FFA3]/40 bg-[#00FFA3]/10 px-4 py-3 text-sm font-bold leading-6 text-[#D7FFEF]"
        >
          장시간 미사용으로 안전하게 자동 로그아웃되었습니다.
        </p>
      ) : null}
      <h1 className="text-[1.85rem] font-extrabold tracking-tight">LoreKeeper</h1>
      <p className="mt-2 text-base font-semibold leading-6 text-[#AEB6C9]">
        방송 중 보는 시청자 브리핑. 계정으로 채널과 카드를 나눠 둡니다.
      </p>

      <button
        type="button"
        onClick={() => {
          void continueWithGoogle();
        }}
        disabled={googleSubmitting || submitting}
        className="mt-8 flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 text-base font-extrabold text-black disabled:opacity-60"
      >
        <GoogleMark />
        {googleSubmitting ? "Google로 이동 중" : "Google로 계속하기"}
      </button>

      <div className="my-6 flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-white/15" />
        <span className="text-sm font-bold text-[#8B93A7]">또는 이메일</span>
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <form
        className="rounded-[22px] bg-[#14171F] px-4 py-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setErrorMessage(null);
              setNotice(null);
            }}
            className={`min-h-12 rounded-2xl text-base font-extrabold ${
              mode === "login" ? "bg-white text-black" : "bg-black text-[#D7DDEA]"
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMessage(null);
              setNotice(null);
            }}
            className={`min-h-12 rounded-2xl text-base font-extrabold ${
              mode === "signup" ? "bg-white text-black" : "bg-black text-[#D7DDEA]"
            }`}
          >
            회원가입
          </button>
        </div>

        <label className="mt-4 block text-sm font-bold text-[#AEB6C9]" htmlFor="email">
          이메일
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@email.com"
            className="mt-1 min-h-12 w-full rounded-2xl bg-black px-4 text-base font-semibold text-white outline-none placeholder:text-[#6E768A]"
          />
        </label>

        <label className="mt-3 block text-sm font-bold text-[#AEB6C9]" htmlFor="password">
          비밀번호
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="6자 이상"
            className="mt-1 min-h-12 w-full rounded-2xl bg-black px-4 text-base font-semibold text-white outline-none placeholder:text-[#6E768A]"
          />
        </label>

        {shownError ? <p className="mt-3 text-sm font-bold text-[#FFB4B4]">{shownError}</p> : null}
        {notice ? <p className="mt-3 text-sm font-bold text-[#B6FFD8]">{notice}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-4 min-h-12 w-full rounded-2xl bg-white text-base font-extrabold text-black disabled:opacity-60"
        >
          {submitting ? "확인 중" : mode === "signup" ? "가입하고 들어가기" : "들어가기"}
        </button>
      </form>
    </main>
  );
}
