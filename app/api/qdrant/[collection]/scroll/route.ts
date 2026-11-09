import { errorResponse, rejectCrossOrigin } from "@/server/http";
import { assertCollection, qdrantConfig, QdrantError, scroll } from "@/server/qdrant";

const MAX = 1000;

// 점을 차례로 읽는다(payload 표, 산점도). 한 번에 1,000개까지, 다음 쪽은 offset으로.
export async function POST(request: Request, ctx: RouteContext<"/api/qdrant/[collection]/scroll">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const config = qdrantConfig();
  if (!config) return errorResponse(400, "NOT_CONFIGURED", ".env.local에 QDRANT_URL이 없습니다.");
  const { collection } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown; offset?: unknown; vectors?: unknown; using?: unknown };
  const limit = Math.max(1, Math.min(MAX, Number(body.limit) || 100));
  const offset = typeof body.offset === "string" || typeof body.offset === "number" ? body.offset : undefined;
  const using = typeof body.using === "string" && body.using.length <= 100 ? body.using : null;
  try {
    await assertCollection(config, collection);
    return Response.json(await scroll(config, collection, { limit, offset, with_vector: body.vectors === true ? (using ? [using] : true) : false }));
  } catch (e) {
    return errorResponse(e instanceof QdrantError && e.status === 404 ? 404 : 502, "QDRANT_FAILED", e instanceof Error ? e.message : String(e));
  }
}
