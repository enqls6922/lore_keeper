import type { HighlightMarkerCard } from "@/lib/briefing-card";
import { stripChzzkEmotes } from "@/lib/chzzk/text";

export function sessionHeading(sessionDate: string): string {
  return sessionDate.replaceAll("-", ".");
}

export function groupMarkers(markers: HighlightMarkerCard[]): Array<[string, HighlightMarkerCard[]]> {
  const groups = new Map<string, HighlightMarkerCard[]>();
  const ordered = [...markers].sort((left, right) => {
    const date = right.sessionDate.localeCompare(left.sessionDate);
    if (date !== 0) {
      return date;
    }
    return left.elapsedSec - right.elapsedSec;
  });
  for (const marker of ordered) {
    const list = groups.get(marker.sessionDate) ?? [];
    list.push(marker);
    groups.set(marker.sessionDate, list);
  }
  return [...groups.entries()];
}

export function timelineText(markers: HighlightMarkerCard[]): string {
  return groupMarkers(markers)
    .map(([sessionDate, list]) => {
      const lines = list.map((marker) => `${marker.formattedTime} - ${stripChzzkEmotes(marker.summary)}`);
      return [`[${sessionHeading(sessionDate)} 방송 하이라이트]`, ...lines].join("\n");
    })
    .join("\n\n");
}

export function TimelineList({
  markers,
  onDelete,
  surface = "compact",
}: {
  markers: HighlightMarkerCard[];
  onDelete?: (marker: HighlightMarkerCard) => void;
  surface?: "compact" | "studio";
}) {
  const card = surface === "studio" ? "border-white/10 bg-[#16181E]" : "border-white/10 bg-[#16181C]";
  const groups = groupMarkers(markers);
  if (groups.length === 0) {
    return (
      <p className={`rounded-[20px] border px-4 py-6 text-sm font-semibold leading-6 text-[#8B93A7] ${card}`}>
        아직 찍힌 하이라이트가 없습니다. 채팅 화력이나 1만 치즈 이상 후원이 오면 여기에 쌓입니다.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([sessionDate, list]) => (
        <section key={sessionDate} className={`rounded-[22px] border px-4 py-4 ${card}`}>
          <h2 className="text-sm font-extrabold text-[#00FFA3]">{sessionHeading(sessionDate)} 방송</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((marker) => (
              <li key={marker.id} className="flex items-start gap-2 text-sm font-bold leading-6 text-white">
                <span className="shrink-0 text-[#FFB800]">{marker.formattedTime}</span>
                <span className="min-w-0 flex-1">{stripChzzkEmotes(marker.summary)}</span>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(marker);
                    }}
                    className="shrink-0 text-xs font-bold text-[#8B93A7]"
                  >
                    삭제
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
