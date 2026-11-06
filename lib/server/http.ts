import "server-only";
import { allowedHostnames } from "@/lib/server/settings";

// 에러 응답은 { error: { code, message } } 하나로 통일한다.
export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 모든 API가 맨 앞에서 부른다. 다른 사이트가 사용자의 브라우저로 이 로컬 API를 부르지 못하게 막는다.
// 1. Host가 127.0.0.1, localhost가 아니면 막는다. 악성 페이지가 자기 도메인을 127.0.0.1로 바꿔 부르는 DNS 리바인딩을 막는다.
// 2. Origin이 있으면 같은 주소여야 한다.
// 3. 바꾸는 요청(POST, DELETE …)은 Origin이 없어도 막고, application/json만 받는다.
//    브라우저는 같은 주소에서 보내는 POST에도 Origin을 붙이므로 이 앱 화면은 그대로 쓸 수 있다.
export function rejectCrossOrigin(request: Request) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  if (!allowedHostnames().has(hostname)) {
    return errorResponse(403, "FORBIDDEN", "허용되지 않은 주소로 들어온 요청입니다. http://127.0.0.1:3000 으로 열어 주세요.");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      // 잘못된 Origin은 다른 곳에서 온 요청으로 본다.
    }
    if (originHost !== host) return errorResponse(403, "FORBIDDEN", "허용되지 않은 요청입니다.");
  }
  if (!SAFE_METHODS.has(request.method)) {
    if (!origin) return errorResponse(403, "FORBIDDEN", "허용되지 않은 요청입니다.");
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("application/json")) return errorResponse(415, "BAD_REQUEST", "JSON 요청만 받습니다.");
  }
  return null;
}
