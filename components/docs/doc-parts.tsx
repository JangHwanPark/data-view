"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { sourceTableLabel } from "@/components/relations/relation-parts";
import type { WorkspaceSource } from "@/components/workspace-provider";
import type { TermState, TermView } from "@/lib/client/doc-analysis";
import type { DocTarget } from "@/lib/client/doc-infer";
import { targetRowValue, termHref } from "@/lib/client/doc-links";

export const STATE_LABEL: Record<TermState, string> = {
  confirmed: "맞음",
  candidate: "확인 필요",
  unmatched: "데이터에 없음",
  ignored: "무시함",
};

export const KIND_LABEL = { name: "이름", id: "ID", quoted: "문자열" } as const;

export function TargetLabel({ target, sources, value }: { target: DocTarget; sources: WorkspaceSource[]; value?: string | null }) {
  const source = sources.find((s) => s.meta.id === target.sourceId);
  return (
    <span>
      {sourceTableLabel(source, target.table)}
      {target.column && <span className="text-zinc-500">.{target.column}</span>}
      {value && <span className="text-zinc-500"> = {value}</span>}
    </span>
  );
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface HighlightProps {
  text: string;
  views: TermView[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}

// 문장 안의 용어에 상태별 표시를 붙인다. 확정한 용어는 데이터로 가는 링크가 되고,
// 나머지는 누르면 용어 패널에서 후보를 고를 수 있다.
export function Highlighted({ text, views, selectedKey, onSelect }: HighlightProps) {
  if (!views.length) return <>{text}</>;
  const byText = new Map(views.map((v) => [v.term.text, v]));
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_])(${[...byText.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![A-Za-z0-9_])`,
    "g",
  );
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const view = byText.get(m[0]);
    if (!view || m.index === undefined) continue;
    parts.push(text.slice(last, m.index));
    parts.push(<TermMark key={m.index} view={view} selected={view.term.key === selectedKey} onSelect={onSelect} />);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function TermMark({ view, selected, onSelect }: { view: TermView; selected: boolean; onSelect?: (key: string) => void }) {
  const { term, state, target, candidates } = view;
  const top = candidates[0];
  const ring = selected ? "ring-2 ring-blue-400" : "";
  if (state === "confirmed" && target) {
    // ID와 따옴표 이름은 그 행을 열고 따라가기 패널까지 띄운다. 테이블 이름은 테이블을 연다.
    const row = targetRowValue(term, target) !== null;
    return (
      <Link
        href={termHref(term, target)}
        className={`rounded-sm text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700 dark:text-blue-400 ${ring}`}
        title={row ? `맞음으로 표시한 곳. 누르면 ${target.table}의 이 행을 엽니다.` : "맞음으로 표시한 곳. 누르면 데이터로 이동합니다."}
      >
        {term.text}
      </Link>
    );
  }
  if (state === "ignored") return <>{term.text}</>;
  const cls =
    state === "candidate"
      ? "rounded-sm bg-amber-100 px-0.5 dark:bg-amber-900/40"
      : "text-red-600 underline decoration-wavy decoration-red-300 underline-offset-2 dark:text-red-400";
  const title =
    state === "candidate" && top
      ? `추정: ${top.target.table}${top.target.column ? "의 " + top.target.column : ""} (${top.reason}). 누르면 맞는 곳을 고를 수 있습니다.`
      : "맞는 테이블이나 값을 찾지 못했습니다. 옛 이름이거나 아직 없는 데이터일 수 있습니다.";
  return (
    <button type="button" onClick={() => onSelect?.(term.key)} className={`${cls} ${ring} cursor-pointer`} title={title}>
      {term.text}
    </button>
  );
}
