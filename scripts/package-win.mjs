// Node 없이 압축 풀고 더블클릭하는 Windows 설치본을 만든다(PLAN.md 29단계, 5-10).
//
//   npm run package:win                         node.exe를 nodejs.org에서 받아(SHASUMS256으로 확인) 넣는다
//   npm run package:win -- --node C:\path\node.exe       가지고 있는 node.exe를 넣는다
//   npm run package:win -- --node node-v22.x-win-x64.zip  받아 둔 공식 압축을 넣는다
//   npm run package:win -- --no-zip              압축하지 않고 dist\data-view 폴더만 만든다
//
// 결과: dist/data-view-win-x64-<버전>.zip
//   data-view/
//     data-view.bat        더블클릭하면 서버를 켜고 브라우저를 연다(영문 ASCII, CRLF)
//     사용법.txt
//     node/node.exe        Windows용 Node(설치하지 않아도 됨)
//     server.js, .next/, node_modules/, public/   Next standalone 빌드(필요한 파일만)
//     fixtures/            가짜 테스트 데이터(npm run fixtures로 새로 만든 game, docs, shape, shape-docs만)
//     .env.example         설정 예시. 복사해 .env.local로 쓴다
//
// 넣지 않는 것: data/(접속 정보, 사용자 설정), 개발용 .next/, .next-package/cache, 그 밖의 fixtures 폴더(시험용 복사본 등).
// 회사로 옮기는 것은 정보보안실이 정한 방법으로만 한다(docs/BRANCHING.md).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "0.0.0";
const nodeVersion = option("--node-version") ?? process.version; // 빌드한 Node와 같은 판을 넣는다
const out = join(root, "dist", "data-view");
const log = (msg) => console.log(`[package] ${msg}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// 1. standalone 빌드(.next-package)
log("빌드: next build (standalone)");
rmSync(join(root, ".next-package"), { recursive: true, force: true });
rmSync(join(root, "dist"), { recursive: true, force: true }); // 예전 결과가 빌드에 따라 들어가지 않게 먼저 지운다
execFileSync(npm, ["run", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, DATA_VIEW_PACKAGE: "1" }, shell: process.platform === "win32" });
const standalone = join(root, ".next-package", "standalone");
if (!existsSync(join(standalone, "server.js"))) throw new Error("standalone 빌드 결과(server.js)가 없습니다.");

// 2. 폴더 꾸리기
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(standalone, out, { recursive: true, filter: (src) => !/[\\/]\.next-package[\\/]cache([\\/]|$)/.test(src) });
// standalone은 distDir 이름(.next-package)을 그대로 쓴다. 정적 파일과 public은 따로 옮겨야 한다(Next 문서).
cpSync(join(root, ".next-package", "static"), join(out, ".next-package", "static"), { recursive: true });
cpSync(join(root, "public"), join(out, "public"), { recursive: true });
cpSync(join(root, ".env.example"), join(out, ".env.example"));
// 개발 PC의 접속 정보나 설정이 섞이지 않게 지운다.
// fixtures는 서버가 경로로 읽는 폴더라 Next가 개발 PC의 것을 통째로 따라 넣는다(시험용 복사본, env 폴더 등). 지우고 아래에서 새로 넣는다.
for (const p of ["data", "fixtures", ".env", ".env.local", ".env.development.local", ".env.production.local"]) rmSync(join(out, p), { recursive: true, force: true });

// 3. 가짜 테스트 데이터. 개발 PC의 fixtures에는 시험용 복사본이 섞일 수 있어 새로 만들고 정한 폴더만 넣는다.
log("가짜 테스트 데이터 만들기: npm run fixtures");
execFileSync(npm, ["run", "fixtures"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
for (const dir of ["game", "docs", "shape", "shape-docs"]) cpSync(join(root, "fixtures", dir), join(out, "fixtures", dir), { recursive: true });

// 4. Windows용 node.exe
mkdirSync(join(out, "node"), { recursive: true });
const given = option("--node");
if (given && given.toLowerCase().endsWith(".exe")) {
  cpSync(given, join(out, "node", "node.exe"));
  const license = join(dirname(given), "LICENSE");
  if (existsSync(license)) cpSync(license, join(out, "node", "LICENSE"));
  log(`node.exe: ${given}`);
} else {
  const zipName = `node-${nodeVersion}-win-x64.zip`;
  let zipData;
  if (given) {
    zipData = readFileSync(given);
    log(`node 압축: ${given}`);
  } else {
    const base = `https://nodejs.org/dist/${nodeVersion}`;
    log(`node 받기: ${base}/${zipName}`);
    const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
    const expected = sums.split("\n").find((l) => l.endsWith(`  ${zipName}`))?.split(/\s+/)[0];
    if (!expected) throw new Error(`SHASUMS256.txt에 ${zipName}이 없습니다.`);
    const res = await fetch(`${base}/${zipName}`);
    if (!res.ok) throw new Error(`node를 받지 못했습니다: HTTP ${res.status}. --node로 받아 둔 node.exe나 압축을 주세요.`);
    zipData = Buffer.from(await res.arrayBuffer());
    const actual = createHash("sha256").update(zipData).digest("hex");
    if (actual !== expected) throw new Error(`node 압축의 SHA256이 다릅니다(받은 ${actual}, 공식 ${expected}).`);
    log("SHA256 확인함");
  }
  const zip = await JSZip.loadAsync(zipData);
  const entry = Object.values(zip.files).find((f) => /(^|\/)node\.exe$/.test(f.name));
  if (!entry) throw new Error("압축 안에 node.exe가 없습니다.");
  writeFileSync(join(out, "node", "node.exe"), await entry.async("nodebuffer"));
  // 라이선스는 같이 넣는다.
  const license = Object.values(zip.files).find((f) => /(^|\/)LICENSE$/.test(f.name));
  if (license) writeFileSync(join(out, "node", "LICENSE"), await license.async("nodebuffer"));
}

// 5. 실행 파일과 안내
const bat = `@echo off
rem data-view (no Node install needed). Double-click to start. Keep this file ASCII only.
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=3000"
set "HOSTNAME=127.0.0.1"
set "NODE_ENV=production"
set "URL=http://127.0.0.1:%PORT%"
if not exist "node\\node.exe" (
  echo [data-view] node\\node.exe is missing. Unzip the whole package again.
  pause
  exit /b 1
)
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [data-view] Already running. Opening the browser only.
  start "" "%URL%"
  exit /b 0
)
rem Open the browser about 3 seconds later, after the server is up.
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start "" %URL%"
echo [data-view] Opening %URL% . Close this window or press Ctrl+C to stop.
"node\\node.exe" server.js
if errorlevel 1 (
  echo [data-view] The server stopped with an error. See the messages above.
  pause
)
`;
writeFileSync(join(out, "data-view.bat"), bat.replace(/\r?\n/g, "\r\n"));
if (/[^\x00-\x7f]/.test(bat)) throw new Error("data-view.bat에 ASCII가 아닌 글자가 있습니다.");
const guide = `data-view ${version} (Windows, Node 설치 없이)

1. 이 압축을 원하는 폴더에 모두 풉니다(바탕 화면이나 문서 폴더처럼 쓰기 권한이 있는 곳).
2. data-view.bat을 더블클릭합니다. 검은 창이 뜨고 잠시 뒤 브라우저가 http://127.0.0.1:3000 을 엽니다.
3. 끝낼 때는 검은 창을 닫습니다.

- 처음 화면의 「테스트용 게임 데이터로 시작하기」, 「회사 시트 모양 테스트 데이터」는 fixtures 폴더의 가짜 데이터를 씁니다.
- 회사 엑셀 폴더를 경로로 열려면 .env.example을 .env.local로 복사하고 DATA_VIEW_ROOTS에 그 폴더를 적은 뒤 다시 켭니다.
- 개발 DB 접속 정보도 .env.local에 적습니다(비밀번호를 화면에서 저장하는 기능은 기본으로 꺼져 있습니다).
- 접속 정보와 설정은 이 폴더의 data 폴더와 %APPDATA%\\data-view에 생깁니다. 다른 사람에게 폴더를 넘길 때는 data 폴더와 .env.local을 빼세요.
- node 폴더의 node.exe는 Node.js ${nodeVersion} 공식 Windows 판입니다(라이선스: node\\LICENSE).
`;
writeFileSync(join(out, "사용법.txt"), "\uFEFF" + guide.replace(/\r?\n/g, "\r\n"));

// 6. 압축
if (!args.includes("--no-zip")) {
  const zip = new JSZip();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = join("data-view", relative(out, full)).split("\\").join("/");
      if (statSync(full).isDirectory()) walk(full);
      else zip.file(rel, readFileSync(full));
    }
  };
  walk(out);
  const file = join(root, "dist", `data-view-win-x64-${version}.zip`);
  writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  log(`만듦: ${relative(root, file)} (${(statSync(file).size / 1024 / 1024).toFixed(1)}MB)`);
} else {
  log(`만듦: ${relative(root, out)}`);
}
