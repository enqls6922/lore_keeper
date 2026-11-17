/** 치지직 채팅 프레임에서 저장할 이벤트만 고른다. 금액은 payAmount 정수만 쓴다. */

import { ANONYMOUS_NICKNAME, isAnonymousDonor } from "@/lib/anonymous";

export const CHZZK_CHAT_URL = "wss://kr-ss1.chat.naver.com/chat";
export const CHZZK_PING_MS = 20_000;

const CMD_CONNECT = 100;
const CMD_PING = 0;
const CMD_PONG = 10000;
export const CHZZK_CMD_CHAT = 93101;
export const CHZZK_CMD_DONATION = 93102;
const MSG_DONATION = 10;

export interface ChzzkInboundEvent {
  cmd: typeof CHZZK_CMD_CHAT | typeof CHZZK_CMD_DONATION;
  userIdHash: string;
  nickname: string;
  message: string;
  cheeseAmount: number;
}

export interface ParsedChzzkFrame {
  events: ChzzkInboundEvent[];
  shouldPong: boolean;
}

export function buildChzzkHandshake(session: {
  chatChannelId: string;
  accessToken: string;
}): {
  ver: "3";
  cmd: typeof CMD_CONNECT;
  svcid: "game";
  cid: string;
  tid: 1;
  bdy: {
    uid: null;
    devType: 2001;
    accTkn: string;
    auth: "READ";
    libVer: "4.9.3";
    osVer: "Windows/10";
    devName: "Google Chrome";
    locale: "ko";
    timezone: "Asia/Seoul";
  };
} {
  return {
    ver: "3",
    cmd: CMD_CONNECT,
    svcid: "game",
    cid: session.chatChannelId,
    tid: 1,
    bdy: {
      uid: null,
      devType: 2001,
      accTkn: session.accessToken,
      auth: "READ",
      libVer: "4.9.3",
      osVer: "Windows/10",
      devName: "Google Chrome",
      locale: "ko",
      timezone: "Asia/Seoul",
    },
  };
}

export function buildChzzkPing(): { ver: "3"; cmd: typeof CMD_PING } {
  return { ver: "3", cmd: CMD_PING };
}

export function buildChzzkPong(): { ver: "2"; cmd: typeof CMD_PONG } {
  return { ver: "2", cmd: CMD_PONG };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function readProfile(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readExtras(value: unknown): Record<string, unknown> | null {
  return readProfile(value);
}

function readRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (!isRecord(body)) {
    return [];
  }
  if (Array.isArray(body.messageList)) {
    return body.messageList.filter(isRecord);
  }
  if (typeof body.msg === "string" || typeof body.content === "string") {
    return [body];
  }
  return [];
}

function readEvent(
  row: Record<string, unknown>,
  cmd: typeof CHZZK_CMD_CHAT | typeof CHZZK_CMD_DONATION,
): ChzzkInboundEvent | null {
  const status = readString(row.msgStatusType) ?? readString(row.messageStatusType);
  if (status === "HIDDEN") {
    return null;
  }

  const profile = readProfile(row.profile);
  const extras = readExtras(row.extras);
  const userIdHash = (profile ? readString(profile.userIdHash) : null) ?? readString(row.uid) ?? "";
  const nicknameRaw =
    (profile ? readString(profile.nickname) : null) ?? (extras ? readString(extras.nickname) : null) ?? "";
  const anonymous = isAnonymousDonor(userIdHash, nicknameRaw);
  if (!anonymous && userIdHash.length === 0) {
    return null;
  }

  const nickname = anonymous ? ANONYMOUS_NICKNAME : nicknameRaw || "시청자";
  const message = (typeof row.msg === "string" ? row.msg : null) ?? (typeof row.content === "string" ? row.content : "") ?? "";
  const messageType = readInteger(row.msgTypeCode) ?? readInteger(row.messageTypeCode);
  const isDonation = cmd === CHZZK_CMD_DONATION || messageType === MSG_DONATION;
  const payAmount = extras ? readInteger(extras.payAmount) : null;
  const cheeseAmount = isDonation && payAmount !== null && payAmount > 0 ? payAmount : 0;

  return {
    cmd,
    userIdHash,
    nickname,
    message,
    cheeseAmount,
  };
}

function isInboundCommand(cmd: number): cmd is typeof CHZZK_CMD_CHAT | typeof CHZZK_CMD_DONATION {
  return cmd === CHZZK_CMD_CHAT || cmd === CHZZK_CMD_DONATION;
}

/** 텍스트 프레임을 이벤트로 바꾼다. 서버 핑(cmd 0)이면 퐁이 필요하다. */
export function parseChzzkFrame(raw: string): ParsedChzzkFrame {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { events: [], shouldPong: false };
  }
  if (!isRecord(payload) || typeof payload.cmd !== "number") {
    return { events: [], shouldPong: false };
  }
  if (payload.cmd === CMD_PING) {
    return { events: [], shouldPong: true };
  }
  if (!isInboundCommand(payload.cmd)) {
    return { events: [], shouldPong: false };
  }

  const cmd = payload.cmd;
  const events = readRows(payload.bdy)
    .map((row) => readEvent(row, cmd))
    .filter((event): event is ChzzkInboundEvent => event !== null);

  return { events, shouldPong: false };
}
