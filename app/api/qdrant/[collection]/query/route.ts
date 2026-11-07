import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { assertCollection, qdrantConfig, query, QdrantError } from "@/lib/server/qdrant";

// 비슷한 점 찾기(33단계). 점 id나 벡터를 받아 가까운 점을 50개까지 돌려준다.
export async function POST(request: Request, ctx: RouteContext<"/api/qdrant/[collection]/query">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const config = qdrantConfig();
  if (!config) return errorResponse(400, "NOT_CONFIGURED", ".env.local에 QDRANT_URL이 없습니다.");
  const { collection } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; vector?: unknown; limit?: unknown; using?: unknown };
  const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
  let q: string | number | number[] | null = null;
  if (typeof body.id === "number" && Number.isInteger(body.id)) q = body.id;
  else if (typeof body.id === "string" && /^[0-9a-fA-F-]{1,64}$/.test(body.id)) q = /^\d+$/.test(body.id) ? Number(body.id) : body.id;
  else if (Array.isArray(body.vector) && body.vector.length <= 8192 && body.vector.every((x) => typeof x === "number" && Number.isFinite(x))) q = body.vector as number[];
  if (q === null) return errorResponse(400, "BAD_REQUEST", "점 id나 벡터를 주세요.");
  const using = typeof body.using === "string" && body.using.length <= 100 ? body.using : undefined;
  try {
    await assertCollection(config, collection);
    return Response.json(await query(config, collection, { query: q, limit, using }));
  } catch (e) {
    return errorResponse(e instanceof QdrantError && e.status === 404 ? 404 : 502, "QDRANT_FAILED", e instanceof Error ? e.message : String(e));
  }
}
