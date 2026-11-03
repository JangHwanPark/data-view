import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { errorCode, listTables, withConnection } from "@/lib/server/mysql";
import { resolveConnection } from "@/lib/server/resolve-connection";

// 테이블 목록과 열 정보
export async function GET(request: Request, ctx: RouteContext<"/api/connections/[id]/tables">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const input = resolveConnection(id);
  if (!input) return errorResponse(404, "NOT_FOUND", "연결을 찾을 수 없습니다.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    return Response.json({ database: input.database, tables });
  } catch (e) {
    return errorResponse(502, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
