const ANONYMOUS_HASH = "anonymous";
const ANONYMOUS_KO = "익명";
const ANONYMOUS_DONOR = "익명의 후원자";

/** 식별자가 없거나 익명 표식인 후원·채팅인지 본다. */
export function isAnonymousDonor(userIdHash: string | null | undefined, nickname: string | null | undefined): boolean {
  const hash = (userIdHash ?? "").trim();
  const name = (nickname ?? "").trim();
  if (hash.length === 0 || hash.toLowerCase() === ANONYMOUS_HASH || hash === ANONYMOUS_KO) {
    return true;
  }
  return name === ANONYMOUS_DONOR || name === ANONYMOUS_KO;
}

export const ANONYMOUS_NICKNAME = ANONYMOUS_DONOR;
