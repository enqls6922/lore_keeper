import { toBriefingCard, toMarkerCard } from "@/lib/briefing-mapper";
import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { prisma } from "@/lib/prisma";
import { toReportCard, type StreamReportCard } from "@/lib/stream-report";

const TOKEN_LENGTH = 36;

export function isShareToken(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value.trim()) && value.trim().length === TOKEN_LENGTH;
}

export async function boardForObsToken(token: string): Promise<{
  briefings: BriefingCard[];
  markers: HighlightMarkerCard[];
} | null> {
  const user = await prisma.user.findUnique({ where: { obsToken: token } });
  if (!user) {
    return null;
  }
  const [briefings, markers] = await Promise.all([
    prisma.briefing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.highlightMarker.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    briefings: briefings.map(toBriefingCard),
    markers: markers.map(toMarkerCard),
  };
}

export async function shareBoardForToken(token: string): Promise<{
  markers: HighlightMarkerCard[];
  reports: StreamReportCard[];
} | null> {
  const user = await prisma.user.findUnique({ where: { editorShareToken: token } });
  if (!user) {
    return null;
  }
  const [markers, reports] = await Promise.all([
    prisma.highlightMarker.findMany({
      where: { userId: user.id },
      orderBy: [{ sessionDate: "desc" }, { elapsedSec: "asc" }],
      take: 200,
    }),
    prisma.streamReport.findMany({
      where: { userId: user.id },
      orderBy: { sessionDate: "desc" },
      take: 60,
    }),
  ]);
  return {
    markers: markers.map(toMarkerCard),
    reports: reports.flatMap((row) => {
      const card = toReportCard(row);
      return card ? [card] : [];
    }),
  };
}
