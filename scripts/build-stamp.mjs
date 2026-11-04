// start.bat이 빌드를 다시 해야 하는지 판단할 때 쓰는 표식.
// 소스 폴더의 파일 수와 가장 늦게 바뀐 시각으로 만든다. git pull이나 직접 고친 파일이 있으면 값이 바뀐다.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIRS = ["app", "components", "lib", "public"];
const FILES = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json"];

let count = 0;
let newest = 0;
function visit(path) {
  let s;
  try {
    s = statSync(path);
  } catch {
    return;
  }
  if (s.isDirectory()) {
    for (const name of readdirSync(path)) visit(join(path, name));
    return;
  }
  count++;
  newest = Math.max(newest, Math.floor(s.mtimeMs));
}
for (const p of [...DIRS, ...FILES]) visit(p);
console.log(`${count}-${newest}`);
