import { rejectCrossOrigin } from "@/lib/server/http";
import { allowedRoots, canSaveDbPasswords, sampleRoot } from "@/lib/server/settings";

// 화면이 알아야 하는 보안 설정. 파일을 열 수 있는 폴더와, DB 비밀번호 저장을 켰는지.
export async function GET(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  return Response.json({ roots: allowedRoots(), sampleRoot: sampleRoot(), saveDbPasswords: canSaveDbPasswords() });
}
