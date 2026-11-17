"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

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

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    if (submitting) {
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
      <h1 className="text-[1.85rem] font-extrabold tracking-tight">LoreKeeper</h1>
      <p className="mt-2 text-base font-semibold leading-6 text-[#AEB6C9]">
        방송 중 보는 시청자 브리핑. 계정으로 채널과 카드를 나눠 둡니다.
      </p>

      <form
        className="mt-8 rounded-[22px] bg-[#14171F] px-4 py-5"
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

        {errorMessage ? <p className="mt-3 text-sm font-bold text-[#FFB4B4]">{errorMessage}</p> : null}
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
