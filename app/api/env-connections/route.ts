import { saveEnvConnection } from "@/lib/server/connections";
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
  if (!input) return errorResponse(404, "NOT_FOUND", "이 DB 접속 정보를 다시 찾지 못했습니다. 접속 정보 파일이 바뀌었는지 확인해 주세요.");
  try {
    const tables = await withConnection(input, (conn) => listTables(conn, input.database));
    // 비밀번호는 저장하지 않고 어느 설정인지만 남긴다. 쓸 때마다 이 설정을 다시 읽는다.
    const { password: _, ...rest } = input;
    void _;
    return Response.json({ connection: saveEnvConnection(rest, { id: body.connect, file }), tableCount: tables.length });
  } catch (e) {
    return errorResponse(400, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
