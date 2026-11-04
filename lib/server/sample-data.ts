import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// 테스트용 게임 데이터(설계 7단계의 생성 스크립트 결과). fixtures 폴더는 git에 없으므로 처음 한 번 만든다.
// 서버를 켠 폴더(저장소 폴더)를 기준으로 한다.
export async function ensureSampleData() {
  const root = process.cwd();
  const game = join(root, "fixtures", "game");
  const docs = join(root, "fixtures", "docs");
  let created = false;
  if (!existsSync(game)) {
    await run(process.execPath, [join(root, "scripts", "generate-game-fixtures.mjs")], { cwd: root, timeout: 300_000 });
    created = true;
  }
  if (!existsSync(docs)) {
    await run(process.execPath, [join(root, "scripts", "generate-doc-fixtures.mjs")], { cwd: root, timeout: 300_000 });
    created = true;
  }
  return { game, docs, created };
}
