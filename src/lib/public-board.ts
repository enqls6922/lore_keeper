import { toBriefingCard, toMarkerCard } from "@/lib/briefing-mapper";
import type { BriefingCard, HighlightMarkerCard } from "@/lib/briefing-card";
import { prisma } from "@/lib/prisma";

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

export async function markersForShareToken(token: string): Promise<HighlightMarkerCard[] | null> {
  const user = await prisma.user.findUnique({ where: { editorShareToken: token } });
  if (!user) {
    return null;
  }
  const rows = await prisma.highlightMarker.findMany({
    where: { userId: user.id },
    orderBy: [{ sessionDate: "desc" }, { elapsedSec: "asc" }],
    take: 200,
  });
  return rows.map(toMarkerCard);
}
