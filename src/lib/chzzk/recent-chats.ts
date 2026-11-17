/** 시청자별 최근 채팅. 서버로 보내지 않고 브라우저 메모리에만 둔다. */
export const MAX_RECENT_CHATS = 15;

/** 2글자 이하이고 자음·모음만 있는 도배(ㅋㅋ, ㅎㅎ, ㅇㅇ)는 맥락이 없다. */
const SHORT_JAMO_SPAM = /^[ㄱ-ㅎㅏ-ㅣ]{1,2}$/;

export function isShortJamoSpam(message: string): boolean {
  return SHORT_JAMO_SPAM.test(message.trim());
}

/** 최근 채팅을 최대 15개까지 FIFO로 붙인다. 짧은 자음·모음 도배는 넣지 않는다. */
export function pushRecentChat(buffer: Map<string, string[]>, userIdHash: string, message: string): void {
  const trimmed = message.trim();
  if (trimmed.length === 0 || isShortJamoSpam(trimmed)) {
    return;
  }

  const current = buffer.get(userIdHash) ?? [];
  current.push(trimmed);
  if (current.length > MAX_RECENT_CHATS) {
    current.splice(0, current.length - MAX_RECENT_CHATS);
  }
  buffer.set(userIdHash, current);
}

/** 후원 전송 직전에 복사본을 꺼낸다. 이후 채팅이 같은 배열을 바꿔도 요청 본문은 그대로다. */
export function copyRecentChats(buffer: Map<string, string[]>, userIdHash: string): string[] {
  return [...(buffer.get(userIdHash) ?? [])];
}
