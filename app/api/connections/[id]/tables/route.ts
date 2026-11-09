import { errorResponse, rejectCrossOrigin } from "@/server/http";
import { errorCode, listTables, withConnection } from "@/server/mysql";
import { resolveConnection } from "@/server/resolve-connection";

// 테이블 목록과 열 정보
export async function GET(request: Request, ctx: RouteContext<"/api/connections/[id]/tables">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const input = await resolveConnection(id);
  if (!input) return errorResponse(404, "NOT_FOUND", "저장된 DB 접속 정보를 찾을 수 없습니다. 다시 연결해 주세요.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    return Response.json({ database: input.database, tables });
  } catch (e) {
    return errorResponse(502, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
