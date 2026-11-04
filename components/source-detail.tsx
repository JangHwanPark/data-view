"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, GitCompareArrows, Loader2, RefreshCw, Table2 } from "lucide-react";
import { sourceVersion, useWorkspace, type WorkspaceSource } from "@/components/workspace-provider";
import { isFileSource } from "@/lib/client/opfs";
import { loadRowCounts, tableKey } from "@/lib/client/schema";

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function SourceDetail({ id }: { id: string }) {
  const { sources, relations, initialized } = useWorkspace();
  const source = sources.find((s) => s.meta.id === id);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const version = source ? sourceVersion(source) : "";

  useEffect(() => {
    if (!version) return;
    let active = true;
    loadRowCounts()
      .then((map) => active && setCounts(map))
      .catch(() => {
        // 행 수는 보조 정보라 실패해도 목록은 보여준다.
      });
    return () => {
      active = false;
    };
  }, [version]);

  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;
  if (!source) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-zinc-500">이 파일을 찾을 수 없습니다. 목록에서 지워졌을 수 있습니다.</p>
        <BackLink />
      </div>
    );
  }

  const { meta, status, error, errorDetail, tables, truncated } = source;
  const relationCount = relations.filter((r) => r.from.sourceId === id || r.to.sourceId === id).length;
  const isDb = !isFileSource(meta);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{meta.name}</h1>
        <p className="text-zinc-500">
          {isFileSource(meta) ? (
            <>
              {meta.kind === "excel" ? "엑셀 파일" : "CSV 파일"}
              {meta.fileName !== meta.name && `, 현재 파일: ${meta.fileName}`}
              {meta.originPath && `, 원본 ${meta.originPath}`}
              {meta.replacedAt && `, ${new Date(meta.replacedAt).toLocaleString()} 교체`}
            </>
          ) : (
            <>
              개발 DB {meta.database}
              {meta.loadedAt && `, ${new Date(meta.loadedAt).toLocaleString()}에 불러옴`}
            </>
          )}
          {status === "ready" && `, 테이블 ${tables.length}개`}
          {relationCount > 0 && `, 확인한 연결 ${relationCount}개`}
        </p>
      </div>

      {isDb ? <DbActions source={source} /> : <FileActions source={source} />}

      {status === "loading" && (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {isDb ? "개발 DB에서 테이블을 불러오는 중입니다." : "파일을 읽는 중입니다."}
        </p>
      )}

      {status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{error}</p>
          {errorDetail && (
            <details className="mt-2">
              <summary className="cursor-pointer">자세히</summary>
              <pre className="mt-1 whitespace-pre-wrap text-xs">{errorDetail}</pre>
            </details>
          )}
        </div>
      )}

      {truncated && truncated.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          행이 많아 테이블마다 앞의 20만 행까지만 불러온 테이블이 있습니다: {truncated.join(", ")}
        </p>
      )}

      {status === "ready" && tables.length === 0 && (
        <p className="text-zinc-500">{isDb ? "테이블이 없습니다." : "데이터가 있는 시트가 없습니다."}</p>
      )}

      {status === "ready" && tables.length > 0 && (
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          {tables.map((table) => {
            const rows = counts.get(tableKey(meta.id, table));
            return (
              <li key={table} className="bg-white dark:bg-zinc-900">
                <Link
                  href={`/sources/${meta.id}/tables/${encodeURIComponent(table)}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Table2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{table}</span>
                  {truncated?.includes(table) && <span className="text-[11px] text-amber-700 dark:text-amber-400">일부</span>}
                  {rows !== undefined && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{rows.toLocaleString()}행</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FileActions({ source }: { source: WorkspaceSource }) {
  const { setHeader, replaceFile, reloadFromOrigin } = useWorkspace();
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const { meta, status } = source;
  if (!isFileSource(meta)) return null;

  async function handleReplace(file: File | undefined) {
    if (!file) return;
    setReplaceError(null);
    try {
      await replaceFile(meta.id, file);
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : String(e));
    }
    if (replaceRef.current) replaceRef.current.value = "";
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {meta.originPath && (
        <button
          type="button"
          disabled={status === "loading"}
          onClick={() => {
            setReplaceError(null);
            reloadFromOrigin(meta.id).catch((e) => setReplaceError(e instanceof Error ? e.message : String(e)));
          }}
          className={buttonClass}
          title={meta.originPath}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          원본 경로에서 다시 읽기
        </button>
      )}
      <button type="button" disabled={status === "loading"} onClick={() => replaceRef.current?.click()} className={buttonClass}>
        <RefreshCw className="size-3.5" aria-hidden />
        새 패치 파일로 교체
      </button>
      {meta.previous && (
        <Link href={`/compare?source=${encodeURIComponent(meta.id)}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400" title={`이전 파일: ${meta.previous.fileName}`}>
          <GitCompareArrows className="size-3.5" aria-hidden />
          이전 파일과 비교
        </Link>
      )}
      <input
        ref={replaceRef}
        type="file"
        accept={meta.kind === "excel" ? ".xlsx,.xls" : ".csv"}
        hidden
        onChange={(e) => void handleReplace(e.target.files?.[0])}
      />
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={meta.header}
          disabled={status === "loading"}
          onChange={(e) => void setHeader(meta.id, e.target.checked)}
        />
        첫 행을 열 제목으로 쓰기
      </label>
      <span className="text-xs text-zinc-500">시트와 열 이름이 같으면 확인해 둔 연결이 그대로 이어집니다. 교체하면 바로 전 파일을 한 벌 남겨 패치 전후 비교에 씁니다.</span>
      {replaceError && <p className="w-full text-red-600">{replaceError}</p>}
    </div>
  );
}

function DbActions({ source }: { source: WorkspaceSource }) {
  const { reloadSource } = useWorkspace();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" disabled={source.status === "loading"} onClick={() => void reloadSource(source.meta.id)} className={buttonClass}>
        <RefreshCw className="size-3.5" aria-hidden />
        다시 불러오기
      </button>
      <span className="text-xs text-zinc-500">
        개발 DB의 지금 내용을 다시 읽어 옵니다. 테이블과 열 이름이 같으면 확인해 둔 연결이 그대로 이어집니다.
      </span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/files" className="inline-flex w-fit items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
      <ChevronLeft className="size-4" aria-hidden />
      불러온 파일
    </Link>
  );
}
