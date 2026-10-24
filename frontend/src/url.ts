// Shareable view state in the query string: ?date=&cutoff=&confidence=&actual=1
export const readParam = (key: string) => new URLSearchParams(window.location.search).get(key);

export function writeParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value == null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
}
