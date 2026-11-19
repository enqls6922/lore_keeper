const EMOTE_PATTERN = /\{:[a-zA-Z0-9_]+:\}/g;

/** 치지직 `{:코드:}` 이모티콘을 지우고 앞뒤 공백을 없앤다. */
export function stripChzzkEmotes(text: string): string {
  return text.replace(EMOTE_PATTERN, " ").replace(/\s+/g, " ").trim();
}
