import { parseConnectionInput } from "@/lib/server/connections";
import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { errorCode, listTables, withConnection } from "@/lib/server/mysql";

// 저장하지 않고 접속만 확인한다.
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const input = parseConnectionInput(await request.json().catch(() => null));
  if (!input) return errorResponse(400, "BAD_REQUEST", "접속 정보가 올바르지 않습니다.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    return Response.json({ tableCount: tables.length });
  } catch (e) {
    return errorResponse(400, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
