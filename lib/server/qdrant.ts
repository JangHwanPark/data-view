import "server-only";

// Qdrant 벡터 DB(33단계). 주소와 키는 .env.local의 QDRANT_URL, QDRANT_API_KEY에서만 읽는다. 키는 브라우저로 보내지 않는다.
// 앱은 읽기만 한다: 컬렉션 목록과 정보, 점 훑기(scroll), 비슷한 점 찾기(query).

export interface QdrantConfig {
  url: string;
  apiKey: string | null;
}

export function qdrantConfig(): QdrantConfig | null {
  const raw = process.env.QDRANT_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { url: u.toString().replace(/\/$/, ""), apiKey: process.env.QDRANT_API_KEY?.trim() || null };
  } catch {
    return null;
  }
}

export class QdrantError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(config: QdrantConfig, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(config.apiKey ? { "api-key": config.apiKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: T; status?: unknown } | null;
  if (!res.ok || !data) throw new QdrantError(res.status, typeof data?.status === "object" && data.status ? JSON.stringify(data.status) : `HTTP ${res.status}`);
  return data.result as T;
}

export interface CollectionInfo {
  name: string;
  status: string;
  points: number;
  size: number | null; // 벡터 차원
  distance: string | null;
  named: string[]; // 이름 붙은 벡터가 여럿이면 그 이름들
}

export async function listCollections(config: QdrantConfig): Promise<CollectionInfo[]> {
  const { collections } = await call<{ collections: { name: string }[] }>(config, "/collections");
  const out: CollectionInfo[] = [];
  for (const { name } of collections) {
    const info = await call<{ status: string; points_count: number | null; config: { params: { vectors: { size?: number; distance?: string } | Record<string, { size: number; distance: string }> } } }>(
      config,
      `/collections/${encodeURIComponent(name)}`,
    );
    const v = info.config?.params?.vectors ?? {};
    const single = typeof (v as { size?: number }).size === "number" ? (v as { size: number; distance: string }) : null;
    const named = single ? [] : Object.keys(v);
    const first = single ?? (named.length ? (v as Record<string, { size: number; distance: string }>)[named[0]] : null);
    out.push({ name, status: info.status, points: Number(info.points_count ?? 0), size: first?.size ?? null, distance: first?.distance ?? null, named });
  }
  return out;
}

export async function assertCollection(config: QdrantConfig, name: string) {
  const { collections } = await call<{ collections: { name: string }[] }>(config, "/collections");
  if (!collections.some((c) => c.name === name)) throw new QdrantError(404, "컬렉션을 찾을 수 없습니다.");
}

export function scroll(config: QdrantConfig, name: string, body: { limit: number; offset?: unknown; with_vector: boolean | string[] }) {
  return call<{ points: { id: string | number; payload?: Record<string, unknown>; vector?: number[] | Record<string, number[]> }[]; next_page_offset?: unknown }>(
    config,
    `/collections/${encodeURIComponent(name)}/points/scroll`,
    { limit: body.limit, ...(body.offset !== undefined && body.offset !== null ? { offset: body.offset } : {}), with_payload: true, with_vector: body.with_vector },
  );
}

export function query(config: QdrantConfig, name: string, body: { query: string | number | number[]; limit: number; using?: string }) {
  return call<{ points: { id: string | number; score: number; payload?: Record<string, unknown> }[] }>(config, `/collections/${encodeURIComponent(name)}/points/query`, {
    query: body.query,
    limit: body.limit,
    with_payload: true,
    ...(body.using ? { using: body.using } : {}),
  });
}
