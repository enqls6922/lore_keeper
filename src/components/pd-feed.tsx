import {
  compareDonations,
  cumulativeLabel,
  formatElapsed,
  isDonationFaded,
  isRadarVisible,
  radarBanner,
  type BriefingCard,
} from "@/lib/briefing-card";

export function PdFeed({
  cards,
  nowMs,
  onPin,
  compact = false,
}: {
  cards: BriefingCard[];
  nowMs: number;
  onPin?: (card: BriefingCard) => void;
  compact?: boolean;
}) {
  const radarCards = cards.filter((card) => isRadarVisible(card, nowMs));
  const donations = cards
    .filter((card) => card.type === "DONATION")
    .sort((left, right) => compareDonations(left, right, nowMs));

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="실시간 PD 레이더" className="flex flex-col gap-2">
        {radarCards.length === 0 ? (
          <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-3 text-sm font-bold text-[#8B93A7]">
            레이더 대기 중. 채팅이 조용하면 분석을 부르지 않습니다.
          </p>
        ) : (
          radarCards.map((card) => {
            const banner = radarBanner(card.category);
            return (
              <article key={card.id} className="rounded-[20px] border border-[#00FFA3]/50 bg-[#16181C] px-4 py-3">
                <p className="text-sm font-extrabold text-[#00FFA3]">
                  {banner.icon} {banner.title}
                </p>
                <p className={`mt-1 font-bold leading-snug text-white ${compact ? "text-base" : "text-lg"}`}>
                  {card.summary}
                </p>
              </article>
            );
          })
        )}
      </section>

      <section aria-label="후원 요약" className="flex flex-col gap-2">
        <h2 className="px-1 text-base font-extrabold">후원 요약</h2>
        {donations.length === 0 ? (
          <p className="rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-6 text-base font-semibold leading-7 text-[#C4CAD8]">
            아직 올라온 후원이 없습니다. 금액과 한 줄 요약만 여기에 뜹니다.
          </p>
        ) : (
          donations.map((card) => {
            const quiet = cumulativeLabel(card);
            return (
              <article
                key={card.id}
                className={`rounded-[20px] border border-white/10 bg-[#16181C] px-4 py-3 ${
                  isDonationFaded(card, nowMs) ? "opacity-40" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-extrabold text-[#FFB800]">
                    <span className="text-white">{card.nickname ?? "후원"}</span>
                    <span>{` +${(card.cheeseAmount ?? 0).toLocaleString("ko-KR")} 치즈`}</span>
                  </p>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {quiet ? <span className="text-[11px] font-semibold text-[#8B93A7]">{quiet}</span> : null}
                    <span className="text-[11px] font-semibold text-[#8B93A7]">
                      {formatElapsed(card.createdAt, nowMs)}
                    </span>
                    {onPin ? (
                      <button
                        type="button"
                        aria-label={card.isPinned ? "고정 해제" : "고정"}
                        aria-pressed={card.isPinned}
                        onClick={() => {
                          onPin(card);
                        }}
                        className={`min-h-8 min-w-8 rounded-xl text-sm ${card.isPinned ? "bg-[#FFB800]/15" : "bg-[#0E0F11]"}`}
                      >
                        📌
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-base font-bold leading-snug text-white">{card.summary}</p>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
