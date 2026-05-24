export function t(key: string, ...substitutions: string[]): string {
  if (typeof chrome === "undefined" || !chrome.i18n) return key;
  const msg = chrome.i18n.getMessage(key, substitutions.length ? substitutions : undefined);
  return msg || key;
}
