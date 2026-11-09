import { errorResponse, rejectCrossOrigin } from "@/server/http";
import { listCollections, qdrantConfig, QdrantError } from "@/server/qdrant";

// 벡터 DB 연결 상태와 컬렉션 목록(33단계). 주소는 보여주되 키는 있는지만 알린다.
export async function GET(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const config = qdrantConfig();
  if (!config) return Response.json({ configured: false });
  try {
    return Response.json({ configured: true, url: config.url, hasKey: !!config.apiKey, collections: await listCollections(config) });
  } catch (e) {
    const status = e instanceof QdrantError ? e.status : 0;
    return errorResponse(502, status === 401 || status === 403 ? "AUTH_FAILED" : "UNREACHABLE", e instanceof Error ? e.message : String(e));
  }
}
