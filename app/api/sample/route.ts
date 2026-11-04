import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";
import { ensureSampleData } from "@/lib/server/sample-data";

// 테스트용 게임 데이터 위치. 없으면 생성 스크립트로 만든 뒤 알려 준다. 파일은 경로 불러오기 API로 읽는다.
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    return Response.json(await ensureSampleData());
  } catch (e) {
    return errorResponse(500, "SAMPLE_FAILED", e instanceof Error ? e.message : String(e));
  }
}
