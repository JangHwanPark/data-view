"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Database, FolderInput, FolderOpen, Plus, Waypoints } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

// 상단 바의 소스 추가 메뉴. 로컬 파일을 열거나 데이터베이스에 연결한다.
export function SourceAddMenu() {
  const { addFile, addDocument } = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  async function handleDocs(files: FileList | null) {
    setError(null);
    let lastId: string | null = null;
    for (const file of Array.from(files ?? [])) {
      try {
        lastId = await addDocument(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (docInputRef.current) docInputRef.current.value = "";
    if (lastId) router.push(`/docs/${lastId}`);
  }

  // 메뉴 밖을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleFiles(files: FileList | null) {
    setError(null);
    let lastId: string | null = null;
    for (const file of Array.from(files ?? [])) {
      try {
        lastId = await addFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
    if (lastId) router.push(`/sources/${lastId}`);
  }

  const itemClass =
    "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-zinc-800";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        <Plus className="size-3.5" aria-hidden />
        소스 추가
        <ChevronDown className="size-3" aria-hidden />
      </button>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={(e) => void handleFiles(e.target.files)} />
      <input ref={docInputRef} type="file" accept=".docx,.pptx,.pdf,.xlsx" multiple hidden onChange={(e) => void handleDocs(e.target.files)} />

      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              inputRef.current?.click();
            }}
          >
            <FolderOpen className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <span>
              <span className="block">로컬 파일 열기</span>
              <span className="block text-xs text-zinc-500">엑셀(xlsx, xls), CSV. 여러 개를 한 번에 열 수 있습니다.</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              router.push("/sources/new/path");
            }}
          >
            <FolderInput className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <span>
              <span className="block">경로에서 불러오기</span>
              <span className="block text-xs text-zinc-500">폴더 경로를 적어 한꺼번에 불러오고, 나중에 같은 경로에서 다시 읽습니다.</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              docInputRef.current?.click();
            }}
          >
            <BookOpen className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <span>
              <span className="block">기획서 열기</span>
              <span className="block text-xs text-zinc-500">워드(docx), PPT(pptx), PDF, 엑셀(xlsx)</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              router.push("/sources/new/database");
            }}
          >
            <Database className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <span>
              <span className="block">데이터베이스 연결</span>
              <span className="block text-xs text-zinc-500">MySQL, MariaDB</span>
            </span>
          </button>
          <button type="button" role="menuitem" className={itemClass} disabled>
            <Waypoints className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <span>
              <span className="block">벡터 DB 연결</span>
              <span className="block text-xs text-zinc-500">Qdrant, 준비 중</span>
            </span>
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="absolute top-full right-0 mt-1 w-64 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
