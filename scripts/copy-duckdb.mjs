// 브라우저에서 워커로 띄우는 파일(DuckDB-WASM, pdf.js)을 public으로 복사한다.
// CDN 대신 로컬에서 서빙해서 오프라인에서도 동작하게 하려는 목적.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const groups = [
  {
    src: join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist"),
    dest: join(root, "public", "duckdb"),
    files: ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"],
  },
  {
    src: join(root, "node_modules", "pdfjs-dist", "build"),
    dest: join(root, "public", "pdfjs"),
    files: ["pdf.worker.min.mjs"],
  },
];

for (const { src, dest, files } of groups) {
  mkdirSync(dest, { recursive: true });
  for (const file of files) copyFileSync(join(src, file), join(dest, file));
  console.log(`copied ${files.length} files to ${dest.slice(root.length + 1)}`);
}
