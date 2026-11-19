import { GoogleGenerativeAI, SchemaType, type GenerationConfig } from "@google/generative-ai";

import { clipText } from "@/lib/chat-radar";

const MODEL_NAME = "gemini-2.5-flash-lite";
const THUMB_LIMIT = 10;

const SYSTEM_PROMPT = `너는 한국어 방송의 방종 후 편집 패키지를 만든다.
주어진 하이라이트와 브리핑에 있는 사실만 쓴다.

반드시 지킬 규칙:
- 추천 멘트와 스트리머 대본은 쓰지 않는다.
- 입력에 없는 후원 금액, 시청자 수, 시간을 만들지 않는다.
- youtubeChapters는 유튜브 설명란에 붙이는 타임라인이다. 첫 줄은 반드시 "00:00:00 인트로"다.
- 각 줄은 "HH:MM:SS 한 줄 설명"이다.
- shortsIdeas는 정확히 3개다. thumbnailCopy는 공백 포함 10자 이내다.
- fanCafeDigest는 팬카페에 올릴 오늘 방송 공지이고, 줄바꿈으로 5줄이다.
- 마크다운 코드펜스는 넣지 않는다.`;

const packagingConfig: GenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: SchemaType.OBJECT,
    properties: {
      youtubeChapters: { type: SchemaType.STRING },
      shortsIdeas: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            timestamp: { type: SchemaType.STRING },
            title: { type: SchemaType.STRING },
            thumbnailCopy: { type: SchemaType.STRING },
            reason: { type: SchemaType.STRING },
          },
          required: ["timestamp", "title", "thumbnailCopy", "reason"],
        },
      },
      fanCafeDigest: { type: SchemaType.STRING },
    },
    required: ["youtubeChapters", "shortsIdeas", "fanCafeDigest"],
  },
};

export interface PackagingSource {
  sessionDate: string;
  liveTitle: string | null;
  category: string | null;
  markers: Array<{ formattedTime: string; triggerType: string; summary: string }>;
  briefings: Array<{ type: string; category: string | null; nickname: string | null; cheeseAmount: number | null; summary: string }>;
}

export interface ShortIdea {
  timestamp: string;
  title: string;
  thumbnailCopy: string;
  reason: string;
}

export interface PackagingDraft {
  youtubeChapters: string;
  shortsIdeas: [ShortIdea, ShortIdea, ShortIdea];
  fanCafeDigest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : null;
}

function thumb(text: string): string {
  const clipped = clipText(text.replace(/\s+/g, " "), THUMB_LIMIT);
  return clipped.length > 0 ? clipped : "하이라이트";
}

function rankedMarkers(source: PackagingSource): PackagingSource["markers"] {
  return [...source.markers].sort((left, right) => {
    const weight = (trigger: string): number => (trigger === "BIG_DONATION" ? 0 : 1);
    return weight(left.triggerType) - weight(right.triggerType);
  });
}

function fallbackShort(marker: PackagingSource["markers"][number] | undefined, index: number): ShortIdea {
  if (!marker) {
    return {
      timestamp: "00:00:00",
      title: `기록 ${index + 1}`,
      thumbnailCopy: "기록 확인",
      reason: "이 회차에서 더 뽑을 하이라이트 기록이 없다.",
    };
  }
  return {
    timestamp: marker.formattedTime,
    title: clipText(marker.summary, 40),
    thumbnailCopy: thumb(marker.summary),
    reason: marker.triggerType === "BIG_DONATION" ? "고액 후원으로 찍힌 구간이다." : "채팅 화력으로 찍힌 구간이다.",
  };
}

export function fallbackPackaging(source: PackagingSource): PackagingDraft {
  const lines = ["00:00:00 인트로"];
  for (const marker of [...source.markers].sort((left, right) => left.formattedTime.localeCompare(right.formattedTime))) {
    if (marker.formattedTime === "00:00:00") {
      continue;
    }
    lines.push(`${marker.formattedTime} ${clipText(marker.summary, 40)}`);
  }
  const picked = rankedMarkers(source);
  const shorts = [fallbackShort(picked[0], 0), fallbackShort(picked[1], 1), fallbackShort(picked[2], 2)] as [
    ShortIdea,
    ShortIdea,
    ShortIdea,
  ];
  const facts = [
    ...source.markers.map((marker) => `${marker.formattedTime} ${marker.summary}`),
    ...source.briefings.map((briefing) => briefing.summary),
  ].filter((line) => line.trim().length > 0);
  const digestLines = [`${source.sessionDate.replaceAll("-", ".")} 방송 기록입니다.`];
  for (const fact of facts) {
    if (digestLines.length >= 5) {
      break;
    }
    digestLines.push(clipText(fact, 80));
  }
  while (digestLines.length < 5) {
    digestLines.push("이 밖에 따로 적힌 기록은 없습니다.");
  }
  return {
    youtubeChapters: lines.join("\n"),
    shortsIdeas: shorts,
    fanCafeDigest: digestLines.slice(0, 5).join("\n"),
  };
}

function normalizeChapters(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const body = lines.filter((line) => line !== "00:00:00 인트로");
  return ["00:00:00 인트로", ...body].join("\n");
}

function readShort(value: unknown, fallback: ShortIdea): ShortIdea {
  if (!isRecord(value)) {
    return fallback;
  }
  const timestamp = typeof value.timestamp === "string" ? value.timestamp.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const thumbnailCopy = typeof value.thumbnailCopy === "string" ? value.thumbnailCopy.trim() : "";
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timestamp) || title.length === 0 || reason.length === 0) {
    return fallback;
  }
  return {
    timestamp,
    title: clipText(title, 80),
    thumbnailCopy: thumb(thumbnailCopy || title),
    reason: clipText(reason, 80),
  };
}

function acceptDraft(value: unknown, source: PackagingSource): PackagingDraft | null {
  if (!isRecord(value) || typeof value.youtubeChapters !== "string" || typeof value.fanCafeDigest !== "string") {
    return null;
  }
  const ideas: unknown = value.shortsIdeas;
  if (!Array.isArray(ideas)) {
    return null;
  }
  const fallback = fallbackPackaging(source);
  const shorts = [0, 1, 2].map((index) => readShort(ideas[index], fallback.shortsIdeas[index])) as [
    ShortIdea,
    ShortIdea,
    ShortIdea,
  ];
  const digestLines = value.fanCafeDigest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (digestLines.length === 0) {
    return null;
  }
  return {
    youtubeChapters: normalizeChapters(value.youtubeChapters),
    shortsIdeas: shorts,
    fanCafeDigest: digestLines.slice(0, 5).join("\n"),
  };
}

/** 회차 기록으로 유튜브 챕터, 쇼츠 3개, 팬카페 5줄을 만든다. */
export async function buildPackaging(source: PackagingSource): Promise<PackagingDraft> {
  const fallback = fallbackPackaging(source);
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error("[packaging] GEMINI_API_KEY가 없어 기록된 사실로 패키지를 만듭니다.");
    return fallback;
  }
  const markerBlock =
    source.markers.length > 0
      ? source.markers.map((marker) => `- ${marker.formattedTime} [${marker.triggerType}] ${marker.summary}`).join("\n")
      : "- 없음";
  const briefingBlock =
    source.briefings.length > 0
      ? source.briefings
          .map((briefing) => `- [${briefing.type}/${briefing.category ?? "-"}] ${briefing.summary}`)
          .join("\n")
      : "- 없음";
  const prompt = [
    `회차: ${source.sessionDate}`,
    `방송 제목: ${source.liveTitle ?? "없음"}`,
    `카테고리: ${source.category ?? "없음"}`,
    "[하이라이트]",
    markerBlock,
    "[브리핑]",
    briefingBlock,
  ].join("\n");
  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: packagingConfig,
    });
    const result = await model.generateContent(prompt);
    const parsed: unknown = JSON.parse(result.response.text());
    return acceptDraft(parsed, source) ?? fallback;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[packaging] 모델 호출에 실패해 기록된 사실로 패키지를 만듭니다. ${message}`);
    return fallback;
  }
}
