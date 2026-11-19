"use client";

import type { StreamReportCard } from "@/lib/stream-report";

async function copyText(text: string, onDone: (message: string) => void, ok: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    onDone("복사하지 못했습니다.");
    return;
  }
  onDone(ok);
}

export function PackagingView({
  report,
  surface = "studio",
  onCopy,
}: {
  report: StreamReportCard;
  surface?: "studio" | "compact";
  onCopy: (message: string) => void;
}) {
  const card = surface === "studio" ? "border-white/10 bg-[#16181E]" : "border-white/10 bg-[#16181C]";
  const well = surface === "studio" ? "bg-[#0B0C0E]" : "bg-[#0E0F11]";

  return (
    <div className="flex flex-col gap-4">
      <section className={`rounded-2xl border p-4 ${card}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold">유튜브 챕터</h3>
          <button
            type="button"
            onClick={() => {
              void copyText(report.youtubeChapters, onCopy, "유튜브 챕터를 복사했습니다.");
            }}
            className="rounded-full bg-[#00FFA3] px-3 py-1.5 text-xs font-extrabold text-[#090A0B]"
          >
            복사
          </button>
        </div>
        <pre className={`mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl px-3 py-3 font-mono text-xs leading-6 text-white ${well}`}>
          {report.youtubeChapters}
        </pre>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-extrabold">추천 쇼츠 TOP 3</h3>
        {report.shortsIdeas.map((idea, index) => (
          <article key={`${idea.timestamp}-${index}`} className={`rounded-2xl border p-4 ${card}`}>
            <p className="text-xs font-bold text-[#FFB800]">{idea.timestamp}</p>
            <p className="mt-2 text-lg font-extrabold leading-snug text-white">{idea.title}</p>
            <p className={`mt-3 inline-flex rounded-lg px-2 py-1 text-sm font-extrabold text-[#090A0B] ${index === 0 ? "bg-[#FFB800]" : "bg-[#00FFA3]"}`}>
              {idea.thumbnailCopy}
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#AEB6C9]">{idea.reason}</p>
          </article>
        ))}
      </section>
      <section className={`rounded-2xl border p-4 ${card}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold">팬카페 5줄 요약</h3>
          <button
            type="button"
            onClick={() => {
              void copyText(report.fanCafeDigest, onCopy, "공지글을 복사했습니다.");
            }}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-extrabold text-white"
          >
            복사
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-white">{report.fanCafeDigest}</p>
      </section>
    </div>
  );
}
