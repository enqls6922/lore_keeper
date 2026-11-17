/** 치지직 공개 API에서 채팅 세션에 필요한 값만 고른다. */

export interface ChzzkSession {
  chatChannelId: string;
  accessToken: string;
  liveTitle: string;
}

export type ChzzkSessionFailure = "not_found" | "offline" | "upstream";

export type ChzzkSessionResult =
  | { ok: true; session: ChzzkSession }
  | { ok: false; reason: ChzzkSessionFailure };

const CHZZK_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface LiveRead {
  httpStatus: number;
  snapshot: { chatChannelId: string; liveTitle: string } | null;
}

function readSnapshot(payload: unknown): { chatChannelId: string; liveTitle: string } | null {
  if (!isRecord(payload)) {
    return null;
  }
  const content = isRecord(payload.content) ? payload.content : payload;
  const chatChannelId = readString(content.chatChannelId);
  if (!chatChannelId) {
    return null;
  }
  const nestedLive = isRecord(content.live) ? content.live : null;
  const liveTitle =
    readString(content.liveTitle) ??
    (nestedLive ? readString(nestedLive.liveTitle) : null) ??
    "제목 없는 방송";
  return { chatChannelId, liveTitle };
}

async function readLive(url: string): Promise<LiveRead> {
  const response = await fetch(url, { headers: CHZZK_HEADERS, cache: "no-store" });
  if (!response.ok) {
    return { httpStatus: response.status, snapshot: null };
  }
  const payload: unknown = await response.json();
  return { httpStatus: response.status, snapshot: readSnapshot(payload) };
}

function readAccessToken(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.content)) {
    return null;
  }
  return readString(payload.content.accessToken);
}

/**
 * 채널 ID로 라이브 제목, 채팅 채널 ID, 읽기 토큰을 가져온다.
 * 방송이 없으면 offline, 채널 자체가 없으면 not_found.
 */
export async function fetchChzzkSession(channelId: string): Promise<ChzzkSessionResult> {
  const encoded = encodeURIComponent(channelId);
  const detailUrl = `https://api.chzzk.naver.com/service/v3.2/channels/${encoded}/live-detail`;
  const statusUrl = `https://api.chzzk.naver.com/polling/v2/channels/${encoded}/live-status`;

  try {
    const detail = await readLive(detailUrl);
    const status = detail.snapshot ? null : await readLive(statusUrl);
    const snapshot = detail.snapshot ?? status?.snapshot ?? null;
    if (!snapshot) {
      const statuses = [detail.httpStatus, status?.httpStatus ?? detail.httpStatus];
      const missing = statuses.every((code) => code === 404);
      return { ok: false, reason: missing ? "not_found" : "offline" };
    }

    const tokenUrl = `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${encodeURIComponent(snapshot.chatChannelId)}&chatType=STREAMING`;
    const tokenResponse = await fetch(tokenUrl, { headers: CHZZK_HEADERS, cache: "no-store" });
    if (!tokenResponse.ok) {
      return { ok: false, reason: "upstream" };
    }
    const accessToken = readAccessToken(await tokenResponse.json());
    if (!accessToken) {
      return { ok: false, reason: "upstream" };
    }

    return {
      ok: true,
      session: {
        chatChannelId: snapshot.chatChannelId,
        accessToken,
        liveTitle: snapshot.liveTitle,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "upstream";
    console.error(`[chzzk session] ${message}`);
    return { ok: false, reason: "upstream" };
  }
}
