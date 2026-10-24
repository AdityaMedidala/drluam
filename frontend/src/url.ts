// Shareable view state in the query string: ?date=&cutoff=&confidence=
export const readParam = (key: string) => new URLSearchParams(window.location.search).get(key);

export function writeParam(key: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
}
