"use client";

import Link from "next/link";
import { ClipboardCopy, GitCompareArrows, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { patchFilterIds, type PatchFilter, type PatchInfo } from "@/components/compare/use-patch-ids";

// 테이블 화면의 「이번 패치」 줄(37단계). 전후 비교에서 바뀐 Id로 표를 거르고, 목록을 복사하거나 테스트 항목으로 넘긴다.
export function PatchBar({
  info,
  sourceId,
  table,
  filter,
  onFilter,
}: {
  info: PatchInfo | null | "loading";
  sourceId: string;
  table: string;
  filter: PatchFilter | null;
  onFilter: (next: PatchFilter | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (info === null) return null;
  if (info === "loading") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        이전 버전과 비교하는 중입니다.
      </p>
    );
  }
  const { summary, ids } = info;
  if (summary.status === "same") return <p className="text-xs text-zinc-500">이번 패치에서 이 테이블은 바뀌지 않았습니다.</p>;
  const compareHref = `/compare?source=${encodeURIComponent(sourceId)}&table=${encodeURIComponent(table)}`;
  const options: { key: PatchFilter | null; label: string }[] = ids
    ? [
        { key: null, label: "모든 행" },
        { key: "all", label: `바뀐 행만 ${(ids.added.length + ids.changed.length).toLocaleString()}` },
        { key: "added", label: `새로 생긴 행 ${ids.added.length.toLocaleString()}` },
        { key: "changed", label: `값이 바뀐 행 ${ids.changed.length.toLocaleString()}` },
      ]
    : [];

  async function copy() {
    if (!ids) return;
    await navigator.clipboard.writeText(patchFilterIds(ids, filter ?? "all").join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-xs dark:border-blue-900 dark:bg-blue-950/30">
      <span className="inline-flex items-center gap-1 font-medium">
        <GitCompareArrows className="size-3.5" aria-hidden />
        이번 패치
      </span>
      <span className="text-zinc-600 dark:text-zinc-400">
        새로 생긴 행 {summary.added.toLocaleString()} · 값이 바뀐 행 {summary.changed.toLocaleString()} · 사라진 행 {summary.removed.toLocaleString()}
      </span>
      {options.map((o) => (
        <button
          key={o.key ?? "none"}
          type="button"
          onClick={() => onFilter(o.key)}
          aria-pressed={filter === o.key}
          className={`rounded border px-1.5 py-0.5 ${filter === o.key ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"}`}
        >
          {o.label}
        </button>
      ))}
      {!ids && summary.status === "changed" && <span className="text-zinc-500">ID 컬럼이 없어 행을 거를 수 없습니다.</span>}
      {ids?.truncated && <span className="text-amber-700 dark:text-amber-400">바뀐 행이 많아 앞의 일부만 거릅니다.</span>}
      <span className="ml-auto flex items-center gap-2">
        {ids && (
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400" title="고른 종류의 Id를 한 줄에 하나씩 복사합니다.">
            <ClipboardCopy className="size-3.5" aria-hidden />
            {copied ? "복사했습니다" : "Id 목록 복사"}
          </button>
        )}
        {ids && (
          <Link href={`/compare/checklist?source=${encodeURIComponent(sourceId)}&table=${encodeURIComponent(table)}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
            <ListChecks className="size-3.5" aria-hidden />
            테스트 항목
          </Link>
        )}
        <Link href={compareHref} className="text-blue-700 hover:underline dark:text-blue-400">
          전후 비교
        </Link>
      </span>
    </div>
  );
}
