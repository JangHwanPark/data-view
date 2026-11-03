import { requestJson } from "@/lib/client/db-import";

export interface LocalFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export function listLocalFiles(path: string) {
  return requestJson<{ files: LocalFileEntry[] }>("/api/local-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).then((r) => r.files);
}

// 서버가 읽은 파일을 브라우저의 File로 만든다. 이후는 파일 선택 창으로 연 것과 똑같이 다룬다.
export async function fetchLocalFile(path: string): Promise<File> {
  const res = await fetch(`/api/local-files?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  const name = path.split(/[\\/]/).pop() ?? path;
  const modified = Date.parse(res.headers.get("X-Modified-At") ?? "");
  return new File([await res.blob()], name, { lastModified: Number.isFinite(modified) ? modified : Date.now() });
}

export function localFileErrorText(code: string) {
  switch (code) {
    case "NOT_FOUND":
      return "경로를 찾을 수 없습니다.";
    case "NO_PERMISSION":
      return "이 경로를 읽을 권한이 없습니다.";
    case "TOO_LARGE":
      return "파일이 너무 큽니다(200MB 초과).";
    case "NOT_ALLOWED":
      return "불러올 수 없는 형식입니다.";
    default:
      return "경로를 읽지 못했습니다.";
  }
}
