import { listConnections, parseConnectionInput, saveConnection } from "@/lib/server/connections";
import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { errorCode, listTables, withConnection } from "@/lib/server/mysql";

// 저장된 연결 목록. 요청 헤더를 읽으므로 빌드 때 미리 만들어지지 않고 요청마다 실행된다.
export async function GET(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  return Response.json({ connections: listConnections() });
}

// 접속을 확인한 뒤에만 저장한다.
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const input = parseConnectionInput(await request.json().catch(() => null));
  if (!input) return errorResponse(400, "BAD_REQUEST", "접속 정보가 올바르지 않습니다.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    return Response.json({ connection: saveConnection(input), tableCount: tables.length });
  } catch (e) {
    return errorResponse(400, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
