import "server-only";
import { existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// 회사에서 실행할 때 바꾸는 보안 설정(설계 PLAN.md 21단계). 모두 .env.local에서 읽는다(Next가 자동으로 읽는다).
//
//   DATA_VIEW_ROOTS               파일을 읽을 수 있는 폴더. 여러 개면 ;로 나눈다. 저장소의 fixtures 폴더는 늘 허용한다
//   DATA_VIEW_SAVE_DB_PASSWORDS   1이면 화면에서 입력한 DB 비밀번호를 암호화해 저장할 수 있다. 기본은 끔
//   DATA_VIEW_ALLOWED_HOSTS       127.0.0.1, localhost 말고 더 허용할 접속 주소(호스트 이름). ;로 나눈다
//   DATA_VIEW_KEY_DIR             암호화 키를 둘 폴더. 없으면 Windows는 %APPDATA%\data-view, 그 밖은 ~/.config/data-view
//   APP_SECRET                    있으면 키 파일 대신 이 값으로 암호화한다

const list = (raw: string | undefined) =>
  (raw ?? "")
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

// 테스트 데이터는 지어낸 값이라 늘 열 수 있게 한다(첫 화면의 테스트용 데이터 불러오기).
export function sampleRoot() {
  return join(process.cwd(), "fixtures");
}

export function allowedRoots() {
  return [...new Set([...list(process.env.DATA_VIEW_ROOTS).map((p) => resolve(p)), sampleRoot()])];
}

export function canSaveDbPasswords() {
  return process.env.DATA_VIEW_SAVE_DB_PASSWORDS === "1";
}

export function allowedHostnames() {
  return new Set(["127.0.0.1", "localhost", "[::1]", ...list(process.env.DATA_VIEW_ALLOWED_HOSTS).map((h) => h.toLowerCase())]);
}

// 암호화 키 폴더. data 폴더만 복사해서는 비밀번호를 풀 수 없게, 키는 data 밖(사용자 폴더)에 둔다.
export function keyDir() {
  if (process.env.DATA_VIEW_KEY_DIR) return resolve(process.env.DATA_VIEW_KEY_DIR);
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "data-view");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "data-view");
}

// 예전에는 키를 data/secret.key에 두었다. 있으면 새 자리로 옮겨, 이미 저장한 비밀번호를 그대로 풀 수 있게 한다.
export function keyFile() {
  const dir = keyDir();
  const file = join(dir, "secret.key");
  const legacy = join(process.cwd(), "data", "secret.key");
  if (!existsSync(file) && existsSync(legacy)) {
    mkdirSync(dir, { recursive: true });
    try {
      renameSync(legacy, file);
    } catch {
      // 드라이브가 다르면 옮기기가 안 되므로 복사한 뒤 지운다.
      copyFileSync(legacy, file);
      unlinkSync(legacy);
    }
  }
  return file;
}
