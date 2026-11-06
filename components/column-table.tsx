"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { useColumnProfiles } from "@/components/column-info";
import { useDomainModel } from "@/components/use-domain-model";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { isDesignRelation } from "@/lib/client/auto-links";
import { columnExamples } from "@/lib/client/column-profile";
import type { LinkEnd } from "@/lib/client/domain-model";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable, tableRules } from "@/lib/client/file-import";
import { dataHref } from "@/lib/client/table-view";
import type { QueryColumn } from "@/lib/query-result";

// 컬럼 표(PLAN.md 24단계, 3-2). 컬럼마다 종류, 설명(#Design, 없으면 #Definition), 값 예시 3개,
// 가리키는 테이블(→)과 이 컬럼을 쓰는 곳(←)을 한 줄에 적는다. Level#1~3처럼 번호 붙은 열 묶음은 한 줄로 합친다.

const TYPE_LABEL: Record<QueryColumn["type"], string> = { string: "글자", number: "숫자", boolean: "참/거짓", date: "날짜", unknown: "기타" };
const tableOf = (key: string) => key.slice(key.indexOf("/") + 1);

interface Row {
  label: string; // 한 줄에 보여줄 이름(Level#1~3)
  columns: QueryColumn[];
}

// 번호 붙은 열 묶음(Level#1, Level#2 … / material_id_1 …)을 한 줄로 합친다. 묶음은 둘 이상일 때만.
export function groupRows(columns: QueryColumn[]): Row[] {
  const baseOf = (name: string) => name.match(/^(.*[#_])\d+$/)?.[1] ?? null;
  const count = new Map<string, number>();
  for (const c of columns) {
    const b = baseOf(c.name);
    if (b) count.set(b, (count.get(b) ?? 0) + 1);
  }
  const rows: Row[] = [];
  const byBase = new Map<string, Row>();
  for (const c of columns) {
    const b = baseOf(c.name);
    if (b && (count.get(b) ?? 0) >= 2) {
      const row = byBase.get(b);
      if (row) {
        row.columns.push(c);
        continue;
      }
      const created = { label: "", columns: [c] };
      byBase.set(b, created);
      rows.push(created);
      continue;
    }
    rows.push({ label: c.name, columns: [c] });
  }
  for (const row of rows) {
    if (row.columns.length > 1) row.label = `${row.columns[0].name}~${row.columns[row.columns.length - 1].name.match(/\d+$/)![0]}`;
  }
  return rows;
}

export function ColumnTable({ id, table }: { id: string; table: string }) {
  const { model, reasons } = useDomainModel();
  const { sources } = useWorkspace();
  const source = sources.find((s) => s.meta.id === id);
  // 페이지를 새로 열면 소스를 다시 읽는 동안 테이블이 없다. 다 읽은 뒤에 컬럼을 묻는다.
  const loadedVersion = source?.status === "ready" ? sourceVersion(source) : null;
  const [columns, setColumns] = useState<QueryColumn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loadedVersion) return;
    let active = true;
    runQuery(`SELECT * FROM ${qualifiedTable(id, table)} LIMIT 0`, 0)
      .then((r) => active && setColumns(r.columns))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [id, table, loadedVersion]);
  const names = (columns ?? []).map((c) => c.name);
  const { profiles, version } = useColumnProfiles(id, table, names, !!columns);
  const [examples, setExamples] = useState<{ key: string; map: Map<string, string[]> } | null>(null);
  const exampleKey = columns ? `${version}|${id}/${table}` : null;
  useEffect(() => {
    if (!exampleKey || !columns) return;
    let active = true;
    columnExamples(id, table, columns.map((c) => c.name), version)
      .then((map) => active && setExamples({ key: exampleKey, map }))
      .catch(() => {});
    return () => {
      active = false;
    };
    // columns는 exampleKey가 바뀔 때만 다시 읽으면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleKey]);

  if (source?.status === "error") return <p className="text-sm text-red-600">이 파일을 읽지 못했습니다. {source.error}</p>;
  if (error) return <p className="text-sm text-red-600">컬럼을 읽지 못했습니다. {error}</p>;
  if (!columns) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        컬럼을 읽는 중
      </p>
    );
  }

  const rules = tableRules(id, table);
  const info = model?.tables.get(`${id}/${table}`);
  const exampleMap = examples?.key === exampleKey ? examples.map : null;
  const rows = groupRows(columns);
  const describedCount = rows.filter((r) => rules?.descriptions.some((d) => r.columns.some((c) => d.columns.includes(c.name)))).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{table}</h1>
        {rules?.title && (
          <span className="text-zinc-600 dark:text-zinc-300" title="#Design 시트 1행의 머리말">
            {rules.title}
          </span>
        )}
        <span className="text-sm text-zinc-500">
          컬럼 {columns.length}개{rows.length !== columns.length ? `(번호 붙은 열을 묶어 ${rows.length}줄)` : ""}
          {rules ? `, 설명 있는 줄 ${describedCount}개` : ""}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        설명은 엑셀의 #Design 시트에서 읽고, 없으면 #Definition 시트의 정의를 「정의」 표시와 함께 보여줍니다. 참조 대상의 실선 테두리는 기획 설명에 적힌 연결, 점선은 앱이 이름과 값으로 찾은 연결입니다.
        {!rules && " 이 테이블은 엑셀이 아니라서 설명 시트가 없습니다."}
      </p>
      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">
            <tr>
              <th className="px-2 py-1.5 font-medium">컬럼</th>
              <th className="px-2 py-1.5 font-medium">종류</th>
              <th className="px-2 py-1.5 font-medium">설명</th>
              <th className="px-2 py-1.5 font-medium">값 예시</th>
              <th className="px-2 py-1.5 font-medium">참조 대상 →</th>
              <th className="px-2 py-1.5 font-medium">← 참조하는 곳</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const names = row.columns.map((c) => c.name);
              const first = row.columns[0];
              const rule = rules?.columns.find((c) => c.name === first.name);
              const desc = rules?.descriptions.find((d) => names.some((n) => d.columns.includes(n)));
              const profile = profiles?.get(first.name);
              const outs = dedupe((info?.out ?? []).filter((l) => names.includes(l.column)));
              const ins = dedupe((info?.in ?? []).filter((l) => names.includes(l.column)));
              const values = [...new Set(names.flatMap((n) => exampleMap?.get(n) ?? []))].slice(0, 3);
              return (
                <tr key={row.label} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="px-2 py-1.5">
                    <span className="font-mono">{row.label}</span>
                    {rule?.group && <div className="text-[11px] text-zinc-500">두 줄 머리글 윗줄: {rule.group}</div>}
                    {rule?.memo && <div className="text-[11px] text-amber-700 dark:text-amber-400">메모 열(DB에 없음)</div>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {TYPE_LABEL[first.type]}
                    {profile?.isId && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-zinc-700 dark:text-zinc-300">
                        <KeyRound className="size-3" aria-hidden />
                        ID
                      </span>
                    )}
                  </td>
                  <td className="max-w-md px-2 py-1.5">
                    {desc ? (
                      <>
                        {desc.from === "definition" && (
                          <span className="mr-1 rounded bg-zinc-100 px-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title="#Design에 없어 #Definition 시트의 정의를 보여줍니다">
                            정의
                          </span>
                        )}
                        {desc.text}
                      </>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {exampleMap ? values.length ? values.join(", ") : <span className="text-zinc-400">빈 칸</span> : <Loader2 className="size-3 animate-spin" aria-hidden />}
                  </td>
                  <td className="px-2 py-1.5">
                    <Ends ends={outs} reasons={reasons} dir="out" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Ends ends={ins} reasons={reasons} dir="in" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 묶음 열은 열마다 연결 끝이 있으므로 같은 연결은 한 번만 적는다.
function dedupe(ends: LinkEnd[]) {
  return [...new Map(ends.map((l) => [`${l.relationId}|${l.group ? "" : l.otherColumn}`, l] as const)).values()];
}

function Ends({ ends, reasons, dir }: { ends: LinkEnd[]; reasons: Map<string, string>; dir: "out" | "in" }) {
  if (!ends.length) return <span className="text-zinc-400">-</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {ends.map((l) => {
        const auto = l.relationId.startsWith("auto:");
        const design = isDesignRelation(l.relationId);
        const other = l.group && dir === "in" ? `${l.group[0]}~${l.group[l.group.length - 1].match(/\d+$/)?.[0] ?? ""}` : l.otherColumn;
        return (
          <li key={`${l.relationId}|${l.otherColumn}`}>
            <Link
              href={dataHref(l.key)}
              title={auto ? reasons.get(l.relationId) : "확인한 연결"}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                auto && !design ? "border-dashed border-zinc-400" : "border-zinc-300 dark:border-zinc-600"
              }`}
            >
              {dir === "out" ? <ArrowRight className="size-3" aria-hidden /> : <ArrowLeft className="size-3" aria-hidden />}
              {tableOf(l.key)}.{other}
              <span className="text-[10px] text-zinc-400">{design ? "기획 설명" : auto ? "앱이 찾음" : "확인함"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
