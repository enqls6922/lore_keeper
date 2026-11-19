"use client";

import { useStudio } from "@/components/DashboardLayout";

export default function IntegrationsPage() {
  const studio = useStudio();
  const obsToken = studio.account?.obsToken ?? "";
  const shareToken = studio.account?.editorShareToken ?? "";

  async function copyLink(path: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    } catch {
      studio.notify("복사하지 못했습니다.");
      return;
    }
    studio.notify(label);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <article className="rounded-2xl border border-white/10 bg-[#16181E] p-5">
        <h2 className="text-lg font-extrabold">OBS 독</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#AEB6C9]">
          브라우저 소스에 이 주소를 넣으면 로그인 없이 레이더와 후원 피드만 세로로 보입니다.
        </p>
        <p className="mt-4 break-all rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-3 font-mono text-xs text-[#D7DDEA]">
          {obsToken.length > 0 ? `/dock/${obsToken}` : "주소를 준비하는 중"}
        </p>
        <button
          type="button"
          disabled={obsToken.length === 0}
          onClick={() => {
            void copyLink(`/dock/${obsToken}`, "OBS 독 주소를 복사했습니다.");
          }}
          className="mt-4 rounded-full bg-[#00FFA3] px-4 py-2 text-sm font-extrabold text-[#090A0B] disabled:opacity-40"
        >
          OBS 독 URL 복사
        </button>
      </article>
      <article className="rounded-2xl border border-white/10 bg-[#16181E] p-5">
        <h2 className="text-lg font-extrabold">편집자 공유</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#AEB6C9]">
          편집자는 이 링크로 회차 타임스탬프를 읽고 텍스트만 복사할 수 있습니다. 지우거나 고칠 수는 없습니다.
        </p>
        <p className="mt-4 break-all rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-3 font-mono text-xs text-[#D7DDEA]">
          {shareToken.length > 0 ? `/share/${shareToken}` : "주소를 준비하는 중"}
        </p>
        <button
          type="button"
          disabled={shareToken.length === 0}
          onClick={() => {
            void copyLink(`/share/${shareToken}`, "편집자 공유 링크를 복사했습니다.");
          }}
          className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-40"
        >
          편집자 공유 링크 복사
        </button>
      </article>
    </div>
  );
}
