import { saveConnection } from "@/lib/server/connections";
import { listEnvConnections, resolveEnvConnection } from "@/lib/server/env-connections";
import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { fileErrorCode } from "@/lib/server/local-files";
import { errorCode, listTables, withConnection } from "@/lib/server/mysql";

// body: { file?: string }            → 찾은 접속 정보 목록(비밀번호 제외)
// body: { file?: string, connect: id } → 그 정보로 접속을 확인하고 연결로 저장
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const body = (await request.json().catch(() => null)) as { file?: unknown; connect?: unknown } | null;
  const file = typeof body?.file === "string" && body.file.trim() ? body.file.trim() : undefined;

  if (typeof body?.connect !== "string") {
    try {
      return Response.json({ connections: await listEnvConnections(file) });
    } catch (e) {
      return errorResponse(400, fileErrorCode(e), e instanceof Error ? e.message : String(e));
    }
  }

  const input = await resolveEnvConnection(body.connect, file).catch(() => null);
  if (!input) return errorResponse(404, "NOT_FOUND", "환경변수에서 이 접속 정보를 다시 찾지 못했습니다.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    return Response.json({ connection: saveConnection(input), tableCount: tables.length });
  } catch (e) {
    return errorResponse(400, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
