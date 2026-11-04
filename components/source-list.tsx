"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, FolderInput, Loader2, Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

export function SourceList() {
  const { sources, initialized, initError, addFile, removeSource } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    setAddError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        await addFile(file);
      } catch (e) {
        setAddError(e instanceof Error ? e.message : String(e));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus className="size-4" aria-hidden />
          파일 열기
        </button>
        <Link
          href="/sources/new/path?kind=data"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <FolderInput className="size-4" aria-hidden />
          폴더 위치로 불러오기
        </Link>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {addError && <p className="w-full text-sm text-red-600">{addError}</p>}
      </div>

      {initError && (
        <p className="text-sm text-red-600">
          저장해 둔 파일 목록을 읽지 못했습니다. ({initError})
        </p>
      )}

      {!initialized ? (
        <p className="text-sm text-zinc-500">불러오는 중...</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-zinc-500">
          아직 불러온 파일이 없습니다. 테이블 엑셀이나 CSV를 불러와 보세요.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {sources.map(({ meta, status, tables }) => {
            const Icon = meta.kind === "excel" ? FileSpreadsheet : FileText;
            return (
              <li key={meta.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-zinc-500" aria-hidden />
                <Link href={`/sources/${meta.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate font-medium">{meta.name}</span>
                </Link>
                <span className="shrink-0 text-sm text-zinc-500">
                  {status === "loading" && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      불러오는 중
                    </span>
                  )}
                  {status === "ready" && `테이블 ${tables.length}개`}
                  {status === "error" && <span className="text-red-600">불러오기 실패</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`${meta.name}을(를) 목록에서 지울까요? 이 파일에 확인해 둔 연결도 함께 지워집니다.`))
                      void removeSource(meta.id);
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                  aria-label={`${meta.name} 삭제`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
