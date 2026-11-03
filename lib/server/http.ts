import "server-only";

// 에러 응답은 { error: { code, message } } 하나로 통일한다.
export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

// 다른 사이트가 사용자의 브라우저로 이 로컬 API를 부르지 못하게, Origin이 있으면 같은 호스트인지 본다.
// request.url은 Next가 다시 만든 주소라 호스트가 브라우저 주소와 다를 수 있어서, 브라우저가 보낸 Host 헤더와 비교한다.
export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (new URL(origin).host === request.headers.get("host")) return null;
  return errorResponse(403, "FORBIDDEN", "허용되지 않은 요청입니다.");
}
