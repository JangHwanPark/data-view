"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { FolderSearch, Loader2 } from "lucide-react";
import { useWorkspace } from "@/core/ui/workspace-provider";
import { useAppConfig } from "@/core/app-config";
import { DbRequestError } from "@/core/db-import";
import { fetchLocalFile, listLocalFiles, localFileErrorText, type LocalFileEntry } from "@/core/local-files";

type Role = "data" | "doc" | "skip";

// 무엇을 불러오러 왔는지. 소스 추가 메뉴의 "데이터 테이블 > 경로 지정"은 data, "기획서 > 경로 지정"은 doc이다.
// 없으면 폴더 안의 모든 파일을 확장자로 나눠 보여준다.
export type PathKind = "data" | "doc" | null;

export function parsePathKind(raw: string | null): PathKind {
  return raw === "data" || raw === "doc" ? raw : null;
}

const LAST_PATH_KEY = "data-view:last-path";
const lastPathKey = (kind: PathKind) => (kind ? `${LAST_PATH_KEY}:${kind}` : LAST_PATH_KEY);

const DOC_ONLY = new Set(["docx", "pptx", "pdf"]);
const DATA_ONLY = new Set(["csv", "xls"]);

// 확장자와 고른 종류로 처음 불러오기 방식을 정한다. xlsx는 데이터일 수도 기획서일 수도 있어 종류를 따른다.
// 고른 종류로 열 수 없는 파일(기획서 경로의 csv, 데이터 경로의 docx)은 건너뛰기로 둔다.
function defaultRole(name: string, kind: PathKind): Role {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (kind === "doc") return DATA_ONLY.has(ext) ? "skip" : "doc";
  if (kind === "data") return DOC_ONLY.has(ext) ? "skip" : "data";
  return DOC_ONLY.has(ext) ? "doc" : "data";
}

const noopSubscribe = () => () => {};

function readLastPath(kind: PathKind) {
  try {
    return localStorage.getItem(lastPathKey(kind)) ?? localStorage.getItem(LAST_PATH_KEY) ?? "";
  } catch {
    return "";
  }
}

const TITLE: Record<"data" | "doc" | "all", { title: string; text: string; placeholder: string }> = {
  data: {
    title: "데이터 테이블을 경로에서 불러오기",
    text: "폴더나 파일 경로를 적으면 그 안의 엑셀(xlsx, xls)과 CSV를 보여줍니다. 원본 경로를 기억해 두어, 갱신본을 같은 자리에 덮어쓴 뒤 '원본 경로에서 다시 읽기'로 바로 교체할 수 있습니다.",
    placeholder: "예: D:\\game\\table 또는 D:\\game\\table\\Item.xlsx",
  },
  doc: {
    title: "기획서를 경로에서 불러오기",
    text: "기획서 폴더나 파일 경로를 적으면 그 안의 워드, PPT, PDF, 엑셀 기획서를 보여줍니다. 새 판을 같은 자리에 덮어쓰면 기획서 화면의 '원본 경로에서 다시 읽기'로 바로 바꿀 수 있고, 맞음으로 표시해 둔 이름도 그대로 이어집니다.",
    placeholder: "예: D:\\game\\기획서 또는 D:\\game\\기획서\\퀘스트.docx",
  },
  all: {
    title: "경로에서 불러오기",
    text: "폴더나 파일 경로를 적으면 그 안의 엑셀, CSV, 기획서(워드, PPT, PDF)를 보여줍니다. 원본 경로를 기억해 두어, 갱신본을 같은 자리에 덮어쓴 뒤 '원본 경로에서 다시 읽기'로 바로 교체할 수 있습니다.",
    placeholder: "예: D:\\game\\table 또는 D:\\game\\table\\Item.xlsx",
  },
};

// 폴더나 파일 경로를 적으면 서버가 목록을 읽고, 고른 파일을 데이터나 기획서로 불러온다.
// 원본 경로를 기억해 두므로 나중에 같은 자리의 갱신본을 "원본 경로에서 다시 읽기"로 교체할 수 있다.
export function PathImport({ kind }: { kind: PathKind }) {
  const { sources, docs, addFile, addDocument } = useWorkspace();
  const router = useRouter();
  const [path, setPath] = useState("");
  // 최근 경로는 서버 렌더링 결과와 어긋나지 않도록 입력칸에 바로 넣지 않고 버튼으로 보여준다.
  const config = useAppConfig();
  const lastPath = useSyncExternalStore(noopSubscribe, () => readLastPath(kind), () => "");
  const copy = TITLE[kind ?? "all"];
  const [files, setFiles] = useState<LocalFileEntry[] | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState<"list" | "import" | null>(null);
  const [error, setError] = useState<{ text: string; detail: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // 이미 같은 경로에서 연 파일은 다시 열지 않도록 표시한다.
  const opened = new Set([
    ...sources.flatMap((s) => ("originPath" in s.meta && s.meta.originPath ? [s.meta.originPath] : [])),
    ...docs.flatMap((d) => (d.meta.originPath ? [d.meta.originPath] : [])),
  ]);

  async function list(e: FormEvent) {
    e.preventDefault();
    setBusy("list");
    setError(null);
    try {
      const result = await listLocalFiles(path.trim());
      setFiles(result);
      setRoles(Object.fromEntries(result.map((f) => [f.path, opened.has(f.path) ? "skip" : defaultRole(f.name, kind)])));
      try {
        localStorage.setItem(lastPathKey(kind), path.trim());
      } catch {
        // 기억하지 못해도 불러오기에는 지장이 없다.
      }
    } catch (err) {
      setFiles(null);
      setError({ text: err instanceof DbRequestError ? localFileErrorText(err.code) : "경로를 읽지 못했습니다.", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function importSelected() {
    if (!files) return;
    setBusy("import");
    setError(null);
    const targets = files.filter((f) => roles[f.path] !== "skip");
    try {
      for (const [i, f] of targets.entries()) {
        setProgress(`${i + 1}/${targets.length} ${f.name}`);
        const file = await fetchLocalFile(f.path);
        if (roles[f.path] === "doc") await addDocument(file, f.path);
        else await addFile(file, f.path);
      }
      // 기획서만 불러왔으면 기획서 목록으로, 그 밖에는 데이터 소스 목록으로 간다.
      router.push(targets.every((f) => roles[f.path] === "doc") ? "/docs" : "/");
    } catch (err) {
      setError({ text: "파일을 불러오지 못했습니다.", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const selectedCount = files?.filter((f) => roles[f.path] !== "skip").length ?? 0;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="text-zinc-500">{copy.text}</p>
        <nav aria-label="불러올 종류" className="mt-2 flex gap-1 text-xs">
          {(
            [
              { k: "data", label: "데이터 테이블" },
              { k: "doc", label: "기획서" },
              { k: null, label: "모두" },
            ] as const
          ).map(({ k, label }) => (
            <Link
              key={label}
              href={k ? `/sources/new/path?kind=${k}` : "/sources/new/path"}
              aria-current={kind === k ? "page" : undefined}
              className={`rounded px-2 py-0.5 ${kind === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <form onSubmit={list} className="flex gap-2">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={copy.placeholder}
          aria-label="경로"
          className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
          required
        />
        <button
          type="submit"
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {busy === "list" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FolderSearch className="size-3.5" aria-hidden />}
          목록 보기
        </button>
      </form>
      {config && (
        <p className="-mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-zinc-500">
          <span>열 수 있는 폴더:</span>
          {config.roots.map((r) => (
            <button key={r} type="button" onClick={() => setPath(r)} className="font-mono text-blue-700 underline dark:text-blue-400" title="누르면 경로 칸에 넣습니다">
              {r}
            </button>
          ))}
          <span className="text-zinc-400">보안 때문에 이 폴더 아래만 엽니다. 더하려면 .env.local의 DATA_VIEW_ROOTS에 적고 앱을 다시 켜 주세요.</span>
        </p>
      )}
      {lastPath && !path && (
        <p className="-mt-2 text-xs text-zinc-500">
          최근 경로:{" "}
          <button type="button" onClick={() => setPath(lastPath)} className="font-mono text-blue-700 underline dark:text-blue-400">
            {lastPath}
          </button>
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{error.text}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs">자세히</summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs">{error.detail}</pre>
          </details>
        </div>
      )}

      {files && files.length === 0 && <p className="text-zinc-500">이 경로에는 불러올 수 있는 파일이 없습니다.</p>}

      {files && files.length > 0 && (
        <>
          <table className="w-full border-collapse overflow-hidden rounded-md border border-zinc-200 bg-white text-xs dark:border-zinc-800 dark:bg-zinc-900">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-800">
              <tr>
                <th className="px-3 py-1.5 font-medium">파일</th>
                <th className="px-2 py-1.5 text-right font-medium">크기</th>
                <th className="px-2 py-1.5 font-medium">수정</th>
                <th className="px-2 py-1.5 font-medium">불러오기</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-1.5">
                    {f.name}
                    {opened.has(f.path) && <span className="ml-1.5 text-zinc-400">이미 열려 있음</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{(f.size / 1024).toFixed(0)} KB</td>
                  <td className="px-2 py-1.5 text-zinc-500">{new Date(f.modifiedAt).toLocaleString()}</td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`${f.name} 불러오기 방식`}
                      value={roles[f.path]}
                      onChange={(e) => setRoles((r) => ({ ...r, [f.path]: e.target.value as Role }))}
                      className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      {/* xlsx는 데이터 테이블일 수도, 엑셀 기획서일 수도 있어서 고를 수 있게 한다. */}
                      {defaultRole(f.name, null) === "data" && <option value="data">데이터</option>}
                      {f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".xls") ? null : <option value="doc">기획서</option>}
                      <option value="skip">건너뛰기</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy !== null || selectedCount === 0}
              onClick={() => void importSelected()}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "import" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {selectedCount}개 불러오기
            </button>
            {progress && <span className="text-xs text-zinc-500">{progress}</span>}
            <span className="ml-auto flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setRoles(Object.fromEntries(files.map((f) => [f.path, opened.has(f.path) ? "skip" : defaultRole(f.name, kind)])))}
                className="rounded px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                기본값으로
              </button>
              <button
                type="button"
                onClick={() => setRoles(Object.fromEntries(files.map((f) => [f.path, "skip" as Role])))}
                className="rounded px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                모두 건너뛰기
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
