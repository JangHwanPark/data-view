import { requestJson } from "@/core/db-import";

// 벡터 DB 화면(33단계)의 브라우저 쪽. 서버(/api/qdrant)를 거쳐 읽기만 한다.

export interface CollectionInfo {
  name: string;
  status: string;
  points: number;
  size: number | null;
  distance: string | null;
  named: string[];
}

export type VectorStatus = { configured: false } | { configured: true; url: string; hasKey: boolean; collections: CollectionInfo[] };

export interface QPoint {
  id: string | number;
  payload?: Record<string, unknown>;
  vector?: number[] | Record<string, number[]>;
}

export const vectorStatus = () => requestJson<VectorStatus>("/api/qdrant");

export function scrollPoints(collection: string, opts: { limit: number; offset?: unknown; vectors?: boolean; using?: string }) {
  return requestJson<{ points: QPoint[]; next_page_offset?: unknown }>(`/api/qdrant/${encodeURIComponent(collection)}/scroll`, {
    method: "POST",
    body: JSON.stringify({ limit: opts.limit, offset: opts.offset, vectors: !!opts.vectors, using: opts.using }),
  });
}

export function similarPoints(collection: string, q: { id?: string | number; vector?: number[]; limit?: number; using?: string }) {
  return requestJson<{ points: { id: string | number; score: number; payload?: Record<string, unknown> }[] }>(`/api/qdrant/${encodeURIComponent(collection)}/query`, {
    method: "POST",
    body: JSON.stringify(q),
  });
}

// payload를 표의 한 행으로 편다. 안쪽 객체는 stats.atk처럼 점으로 잇고, 글자·숫자 목록은 |로 잇는다.
export function flattenPayload(payload: Record<string, unknown> | undefined, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(payload ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flattenPayload(v as Record<string, unknown>, key, out);
    else if (Array.isArray(v)) out[key] = v.every((x) => x === null || typeof x !== "object") ? v.join("|") : JSON.stringify(v);
    else out[key] = v;
  }
  return out;
}

export function vectorOf(p: QPoint, using?: string): number[] | null {
  if (Array.isArray(p.vector)) return p.vector;
  if (p.vector && using && Array.isArray(p.vector[using])) return p.vector[using];
  return null;
}

// 2차원 투영(주성분 분석). 공분산 행렬을 만들지 않고 X^T(Xv)를 되풀이하는 거듭제곱법으로 첫째, 둘째 축을 구한다.
// 차원이 1,536이어도 점 2,000개면 브라우저에서 금방 끝난다. 무리가 갈라지는지 보는 그림이라 축 값 자체에는 뜻이 없다.
export function pca2d(vectors: number[][]): [number, number][] {
  const n = vectors.length;
  if (!n) return [];
  const d = vectors[0].length;
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const X = vectors.map((v) => Float64Array.from(v, (x, j) => x - mean[j]));
  const axes: Float64Array[] = [];
  for (let k = 0; k < 2; k++) {
    let w = Float64Array.from({ length: d }, (_, j) => Math.sin(j * 12.9898 + k * 78.233));
    for (let it = 0; it < 60; it++) {
      const xw = X.map((row) => row.reduce((s, x, j) => s + x * w[j], 0));
      const next = new Float64Array(d);
      X.forEach((row, i) => {
        for (let j = 0; j < d; j++) next[j] += row[j] * xw[i];
      });
      // 앞 축 방향은 빼서(직교) 둘째 축을 구한다.
      for (const a of axes) {
        const dot = next.reduce((s, x, j) => s + x * a[j], 0);
        for (let j = 0; j < d; j++) next[j] -= dot * a[j];
      }
      const norm = Math.hypot(...next) || 1;
      w = next.map((x) => x / norm);
    }
    axes.push(w);
  }
  return X.map((row) => [row.reduce((s, x, j) => s + x * axes[0][j], 0), row.reduce((s, x, j) => s + x * axes[1][j], 0)]);
}

// 펼친 payload 행을 CSV로. 불러오기는 CSV 파일로 넘겨 다른 파일과 같은 길(DuckDB)로 읽는다.
export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}
