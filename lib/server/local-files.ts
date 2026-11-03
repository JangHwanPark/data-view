import "server-only";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

// 경로를 지정해서 불러올 수 있는 확장자. 이 밖의 파일은 목록에도 넣지 않고 내용도 넘기지 않는다.
export const DATA_EXTENSIONS = [".xlsx", ".xls", ".csv"];
export const DOC_EXTENSIONS = [".docx", ".pptx", ".pdf", ".xlsx"];
const ALLOWED = new Set([...DATA_EXTENSIONS, ...DOC_EXTENSIONS]);
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface LocalFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export function isAllowed(path: string) {
  return ALLOWED.has(extname(path).toLowerCase());
}

// 폴더면 안의 파일(하위 폴더 제외)을, 파일이면 그 파일 하나를 돌려준다. 엑셀 임시 파일(~$)은 뺀다.
export async function listLocalFiles(input: string): Promise<LocalFileEntry[]> {
  const target = resolve(input);
  const info = await stat(target);
  const paths = info.isDirectory()
    ? (await readdir(target, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(target, d.name))
    : [target];
  const entries: LocalFileEntry[] = [];
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path;
    if (!isAllowed(path) || name.startsWith("~$")) continue;
    const s = await stat(path);
    entries.push({ path, name, size: s.size, modifiedAt: s.mtime.toISOString() });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readLocalFile(path: string) {
  const target = resolve(path);
  if (!isAllowed(target)) throw Object.assign(new Error("not allowed"), { code: "NOT_ALLOWED" });
  const s = await stat(target);
  if (!s.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
  if (s.size > MAX_FILE_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
  return { bytes: await readFile(target), modifiedAt: s.mtime.toISOString() };
}

export function fileErrorCode(e: unknown) {
  const code = (e as { code?: string })?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return "NOT_FOUND";
  if (code === "EACCES" || code === "EPERM") return "NO_PERMISSION";
  if (code === "NOT_ALLOWED" || code === "TOO_LARGE") return code;
  return "READ_FAILED";
}
