import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { errorCode, listTables, readTable, TABLE_ROW_LIMIT, withConnection } from "@/lib/server/mysql";
import { resolveConnection } from "@/lib/server/resolve-connection";

// 테이블 하나의 행. 브라우저가 DuckDB에 스냅샷으로 넣을 때 쓴다.
export async function GET(request: Request, ctx: RouteContext<"/api/connections/[id]/tables/[table]">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id, table } = await ctx.params;
  const input = await resolveConnection(id);
  if (!input) return errorResponse(404, "NOT_FOUND", "저장된 DB 접속 정보를 찾을 수 없습니다. 다시 연결해 주세요.");
  try {
    const result = await withConnection(input, async (conn) => {
      // 목록에 있는 테이블만 읽는다. 이름을 그대로 SQL에 넣지 않기 위해서다.
      const target = (await listTables(conn, input.database)).find((t) => t.name === table);
      if (!target) return null;
      return { columns: target.columns, ...(await readTable(conn, target, TABLE_ROW_LIMIT)) };
    });
    if (!result) return errorResponse(404, "NOT_FOUND", "테이블을 찾을 수 없습니다.");
    return Response.json(result);
  } catch (e) {
    return errorResponse(502, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
