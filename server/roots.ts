import "server-only";
import { realpath } from "node:fs/promises";
import { relative, resolve, isAbsolute } from "node:path";
import { allowedRoots } from "@/server/settings";

// 파일을 읽을 수 있는 곳을 정한 폴더 아래로 묶는다(PLAN.md 1-4).
// 바로가기(심볼릭 링크)로 바깥을 가리키는 경우도 막으려고 실제 경로(realpath)로 비교한다.
const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

function inside(path: string, root: string) {
  const rel = relative(norm(root), norm(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function assertAllowedPath(input: string) {
  const target = resolve(input);
  const real = await realpath(target).catch(() => target);
  const roots = await Promise.all(allowedRoots().map((r) => realpath(r).catch(() => r)));
  if (!roots.some((r) => inside(real, r))) {
    throw Object.assign(new Error(`outside allowed folders: ${target}`), { code: "OUTSIDE_ROOT" });
  }
  return target;
}
