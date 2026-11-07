"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import type { DocCheckIssue, DocCheckResult } from "@/lib/client/doc-check";
import { tableHref } from "@/lib/client/doc-links";

const SHOW_OPEN = 20; // 이 수 이하면 목록을 펼친 채로 보여준다

// 기획서 화면 위쪽의 "데이터와 맞춰 본 결과". QA가 먼저 볼 곳이라 본문보다 위에 둔다.
export function DocCheckPanel({ check }: { check: DocCheckResult | "error" | null }) {
  const [open, setOpen] = useState<boolean | null>(null);
  if (check === null) {
    return (
      <p className="inline-flex items-center gap-2 text-xs text-zinc-500">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        기획서 표의 값을 데이터와 맞춰 보는 중
      </p>
    );
  }
  if (check === "error") return <p className="text-xs text-red-600">기획서 표의 값을 데이터와 맞춰 보지 못했습니다. 데이터 파일이 다 열렸는지 확인해 주세요.</p>;

  const values = check.issues.filter((i) => i.kind === "value");
  const missing = check.issues.filter((i) => i.kind === "missing-row");
  const rows = check.compared.reduce((n, t) => n + t.rows, 0);
  const expanded = open ?? check.issues.length <= SHOW_OPEN;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  if (check.compared.length === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        이 기획서에는 데이터와 값을 비교할 수 있는 표가 없습니다. 표의 머리글에 quest_id, item_id처럼 테이블의 ID 컬럼 이름이 있어야 그 ID의 행을 찾아 비교합니다.
      </p>
    );
  }

  const ok = check.issues.length === 0;
  return (
    <section
      className={`rounded-md border px-3 py-2 text-xs ${ok ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"}`}
      aria-label="데이터와 맞춰 본 결과"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ok ? <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> : <TriangleAlert className="size-4 text-red-700 dark:text-red-400" aria-hidden />}
        <span className="font-medium">
          {ok ? "기획서 표의 값이 모두 데이터와 같습니다." : `데이터와 다른 값 ${values.length}개, 데이터에 없는 ID ${missing.length}개`}
        </span>
        <span className="text-zinc-500">
          기획서 표 {check.compared.length}개, {rows.toLocaleString()}행을 데이터와 비교했습니다
          {check.skipped ? `. ID 컬럼이 없어 비교하지 못한 표 ${check.skipped}개` : ""}.
        </span>
        {!ok && (
          <button type="button" onClick={() => setOpen(!expanded)} className="ml-auto inline-flex items-center gap-0.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" aria-expanded={expanded}>
            <Chevron className="size-3.5" aria-hidden />
            {expanded ? "목록 접기" : "목록 보기"}
          </button>
        )}
      </div>
      {!ok && expanded && (
        <ul className="mt-2 flex flex-col divide-y divide-red-100 rounded border border-red-100 bg-white dark:divide-red-950 dark:border-red-950 dark:bg-zinc-900">
          {[...values, ...missing].map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] text-zinc-500">
        표의 칸 값만 비교합니다. &ldquo;보상 골드: 500&rdquo;처럼 문장 속에 쓴 수치는 아직 비교하지 않습니다.
      </p>
    </section>
  );
}

function IssueRow({ issue }: { issue: DocCheckIssue }) {
  const href = tableHref(issue.sourceId, issue.table, { column: issue.keyColumn, value: issue.key });
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2.5 py-1.5">
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${issue.kind === "value" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
      >
        {issue.kind === "value" ? "다른 값" : "데이터에 없는 ID"}
      </span>
      <a href={`#${issue.sectionId}`} className="text-zinc-500 hover:underline">
        {issue.sectionTitle}
      </a>
      <span>
        {issue.table} {issue.keyColumn} <strong className="tabular-nums">{issue.key}</strong>
      </span>
      {issue.kind === "value" ? (
        <span>
          · {issue.column}: 기획서 <strong className="tabular-nums text-red-700 dark:text-red-400">{issue.docValue}</strong>, 데이터{" "}
          <strong className="tabular-nums">{issue.dataValue ?? "(비어 있음)"}</strong>
        </span>
      ) : (
        <span className="text-zinc-600 dark:text-zinc-400">· 기획서에는 있지만 데이터에는 이 ID의 행이 없습니다. 옛 기획이거나 데이터가 빠졌을 수 있습니다.</span>
      )}
      {issue.kind === "value" && (
        <Link href={href} className="ml-auto shrink-0 text-blue-700 hover:underline dark:text-blue-400">
          데이터에서 보기
        </Link>
      )}
    </li>
  );
}
