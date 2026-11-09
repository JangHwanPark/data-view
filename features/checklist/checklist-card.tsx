"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import type { CheckItem } from "./checklist";
import type { CheckStatus } from "@/core/opfs";

// 테스트 항목 카드 하나. 기획서 기준 테스트 항목(26~29단계)과 패치 테스트 항목(37단계)이 같이 쓴다.
export const STATUS: { key: CheckStatus; label: string; tone: string }[] = [
  { key: "ok", label: "확인", tone: "bg-emerald-600 text-white" },
  { key: "problem", label: "문제", tone: "bg-red-600 text-white" },
  { key: "hold", label: "보류", tone: "bg-amber-500 text-white" },
];

interface CardProps {
  item: CheckItem;
  state?: { status: CheckStatus; memo: string };
  onChange: (patch: Partial<{ status: CheckStatus; memo: string }>) => void;
}

export function ChecklistCard({ item, state, onChange }: CardProps) {
  const [memo, setMemo] = useState<string | null>(null);
  const status = state?.status ?? "todo";
  const treeHref = `/sources/${item.sourceId}/tables/${encodeURIComponent(item.table)}?view=data&tree=${encodeURIComponent(JSON.stringify({ column: item.keyColumn, value: item.id }))}`;
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-md border bg-white px-3 py-2 text-xs dark:bg-zinc-900 ${item.flags.length ? "border-red-200 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-zinc-500">{item.table}</span>
        <span className="font-semibold tabular-nums">{item.id}</span>
        {item.title && <span className="text-sm">{item.title}</span>}
        {item.found && (
          <Link href={treeHref} className="text-blue-700 hover:underline dark:text-blue-400">
            데이터에서 보기
          </Link>
        )}
        <div className="ml-auto flex gap-1">
          {STATUS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ status: status === s.key ? "todo" : s.key })}
              aria-pressed={status === s.key}
              className={`rounded px-2 py-0.5 ${status === s.key ? s.tone : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {item.flags.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {item.flags.map((f) => (
            <li key={f} className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}
      {item.notes && item.notes.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {item.notes.map((n) => (
            <li key={n} className="inline-flex items-start gap-1 text-blue-800 dark:text-blue-300">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="break-all">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {item.lines.length > 0 && (
        <ul className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
          {item.lines.map((l, i) => (
            <li key={i} className={`truncate ${l.missing ? "text-red-600 dark:text-red-400" : ""}`} style={{ paddingLeft: (l.depth - 1) * 16 }} title={l.text}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label={`${item.table} ${item.id} 메모`}
        rows={1}
        value={memo ?? state?.memo ?? ""}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => {
          if (memo !== null && memo !== (state?.memo ?? "")) onChange({ memo });
          setMemo(null);
        }}
        placeholder="메모 (예: 보상 개수 기획서와 다름, 담당자 확인 중)"
        className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
      />
    </li>
  );
}
