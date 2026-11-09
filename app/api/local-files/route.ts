import { errorResponse, rejectCrossOrigin } from "@/server/http";
import { fileErrorCode, listLocalFiles, readLocalFile } from "@/server/local-files";

// 경로의 파일 목록. 로컬 단일 사용자 도구라 127.0.0.1에서만 열리고, 정해 둔 확장자만 다룬다.
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  if (typeof body?.path !== "string" || !body.path.trim()) return errorResponse(400, "BAD_REQUEST", "경로를 입력해 주세요.");
  try {
    return Response.json({ files: await listLocalFiles(body.path.trim()) });
  } catch (e) {
    return errorResponse(400, fileErrorCode(e), e instanceof Error ? e.message : String(e));
  }
}

// 파일 하나의 내용. ?path=로 받는다.
export async function GET(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const path = new URL(request.url).searchParams.get("path");
  if (!path) return errorResponse(400, "BAD_REQUEST", "경로가 없습니다.");
  try {
    const { bytes, modifiedAt } = await readLocalFile(path);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "X-Modified-At": modifiedAt },
    });
  } catch (e) {
    return errorResponse(400, fileErrorCode(e), e instanceof Error ? e.message : String(e));
  }
}
