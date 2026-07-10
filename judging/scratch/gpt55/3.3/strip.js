const SEARCH_DIACRITICS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function stripDiacritics(verse: string): string {
  return verse.replace(SEARCH_DIACRITICS_RE, "");
}
