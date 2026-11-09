// 테이블 화면의 보기(설계 4.13 G1, G2). 관계도, 데이터, 컬럼 표(24단계)이고, 마지막으로 고른 보기를 브라우저에 기억한다.
// 처음 쓰는 사람은 관계도부터 본다. 사이드바 링크는 보기를 적지 않고, 테이블 화면이 이 규칙으로 고른다.
export type TableView = "graph" | "data" | "columns";

const KEY = "data-view:table-view";
const listeners = new Set<() => void>();

export function readLastView(): TableView {
  try {
    return parseView(localStorage.getItem(KEY)) ?? "graph";
  } catch {
    return "graph";
  }
}

export function rememberView(view: TableView) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 기억하지 않고 기본값을 쓴다.
  }
  listeners.forEach((l) => l());
}

export function subscribeLastView(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function parseView(raw: string | null): TableView | null {
  return raw === "graph" || raw === "data" || raw === "columns" ? raw : null;
}

export function parseDepth(raw: string | null): 1 | 2 {
  return raw === "2" ? 2 : 1;
}

// 지나온 테이블(테이블 키 목록). 주소의 via 쿼리에 둔다. 너무 길어지지 않게 최근 것만 남긴다.
export const MAX_VIA = 8;

export function parseVia(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data.filter((k): k is string => typeof k === "string" && k.includes("/")).slice(-MAX_VIA) : [];
  } catch {
    return [];
  }
}

export function graphHref(key: string, opts: { depth?: 1 | 2; via?: string[] } = {}) {
  const slash = key.indexOf("/");
  const params = new URLSearchParams({ view: "graph" });
  if (opts.depth === 2) params.set("depth", "2");
  if (opts.via?.length) params.set("via", JSON.stringify(opts.via.slice(-MAX_VIA)));
  return `/sources/${key.slice(0, slash)}/tables/${encodeURIComponent(key.slice(slash + 1))}?${params}`;
}

export function dataHref(key: string) {
  const slash = key.indexOf("/");
  return `/sources/${key.slice(0, slash)}/tables/${encodeURIComponent(key.slice(slash + 1))}?view=data`;
}
