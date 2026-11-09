"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ListChecks, Loader2, Table2 } from "lucide-react";
import { useDomainModel } from "@/components/use-domain-model";
import { brokenUses, compareTable, DETAIL_LIMIT, type BrokenUse, type TableDetail, type TableSummary } from "@/lib/client/compare";
import { tableHref } from "@/lib/client/doc-links";
import type { SourceMeta } from "@/lib/client/opfs";

// 시트 하나의 자세한 비교. 값이 바뀐 행, 새로 생긴 ID, 사라진 ID, 사라진 ID를 아직 쓰는 곳을 보여준다.
export function TableDiff({ meta, summary }: { meta: SourceMeta; summary: TableSummary }) {
  const [detail, setDetail] = useState<TableDetail | string | null>(null);
  const { model } = useDomainModel();
  const tableKey = `${meta.id}/${summary.table}`;

  useEffect(() => {
    let active = true;
    compareTable(meta, summary)
      .then((d) => active && setDetail(d))
      .catch((e) => active && setDetail(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
    // 시트가 바뀌면 컴포넌트를 새로 만든다(key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 이 시트의 ID 열을 쓰는 다른 테이블. 시스템 지도와 같은 연결 정보를 쓴다.
  const users = summary.key
    ? [...new Map((model?.tables.get(tableKey)?.in ?? []).filter((l) => l.column === summary.key && l.key !== tableKey).map((l) => [`${l.key}|${l.otherColumn}`, { key: l.key, column: l.otherColumn }])).values()]
    : [];
  const usersKey = JSON.stringify(users);
  const [broken, setBroken] = useState<{ key: string; value: BrokenUse[] } | null>(null);
  useEffect(() => {
    if (!model || !summary.key || summary.removed === 0) return;
    let active = true;
    brokenUses(meta, summary, users).then((value) => active && setBroken({ key: usersKey, value }));
    return () => {
      active = false;
    };
    // users는 usersKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersKey, !!model]);

  const rowLink = (value: string) => (summary.key ? tableHref(meta.id, summary.table, { column: summary.key, value }) : null);
  const tableName = (key: string) => key.slice(key.indexOf("/") + 1);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <h2 className="font-semibold">
        {summary.table}
        <span className="ml-2 text-xs font-normal text-zinc-500">{summary.key ? `ID 컬럼 ${summary.key} 기준으로 비교` : "ID 컬럼이 없어 줄 단위로 비교"}</span>
      </h2>
      {summary.key && summary.status === "changed" && summary.added + summary.changed > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-zinc-500">새로 생긴 행과 값이 바뀐 행을</span>
          <Link href={`${tableHref(meta.id, summary.table)}?view=data&patch=all`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
            <Table2 className="size-3.5" aria-hidden />
            테이블 화면에서 거르기
          </Link>
          <Link href={`/compare/checklist?source=${encodeURIComponent(meta.id)}&table=${encodeURIComponent(summary.table)}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
            <ListChecks className="size-3.5" aria-hidden />
            테스트 항목으로 만들기
          </Link>
        </p>
      )}

      {summary.removed > 0 && summary.key && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" aria-hidden />이 변경으로 깨지는 곳
          </p>
          {!model ? (
            <p className="mt-1 inline-flex items-center gap-1 opacity-80">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              테이블끼리 이어진 곳을 찾는 중입니다.
            </p>
          ) : broken === null || broken.key !== usersKey ? (
            <p className="mt-1 inline-flex items-center gap-1 opacity-80">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              사라진 ID를 참조하는 곳을 세는 중입니다.
            </p>
          ) : broken.value.length === 0 ? (
            <p className="mt-1 opacity-80">사라진 ID {summary.removed.toLocaleString()}개를 참조하는 다른 테이블은 없습니다.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {broken.value.map((b) => (
                <li key={`${b.table}|${b.column}`}>
                  <span className="font-medium">{tableName(b.table)}</span>의 {b.column} {b.rows.toLocaleString()}행이 사라진 ID를 아직 씁니다:{" "}
                  {b.ids.map((id) => (
                    <Link key={id} href={tableHref(b.table.slice(0, b.table.indexOf("/")), tableName(b.table), { column: b.column, value: id })} className="mr-1 underline underline-offset-2">
                      {id}
                    </Link>
                  ))}
                  {b.rows > b.ids.length && <span className="opacity-70">…</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {detail === null ? (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          바뀐 내용을 모으는 중입니다.
        </p>
      ) : typeof detail === "string" ? (
        <p className="text-red-600">자세히 비교하지 못했습니다. {detail}</p>
      ) : (
        <>
          {detail.changed.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-zinc-500">
                값이 바뀐 행 {summary.changed.toLocaleString()}개{summary.changed > DETAIL_LIMIT && ` (앞의 ${DETAIL_LIMIT}개만 표시)`}
              </h3>
              <div className="max-h-[28rem] overflow-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-left dark:bg-zinc-800">
                    <tr>
                      <th className="px-2 py-1 font-medium">{summary.key}</th>
                      <th className="px-2 py-1 font-medium">바뀐 값 (전 → 후)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changed.map((row) => {
                      const href = rowLink(row.id);
                      return (
                        <tr key={row.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                          <td className="px-2 py-1 font-mono tabular-nums">
                            {href ? (
                              <Link href={href} className="text-blue-700 hover:underline dark:text-blue-400" title="지금 파일에서 이 행 보기">
                                {row.id}
                              </Link>
                            ) : (
                              row.id
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                              {row.cells.map((c) => (
                                <span key={c.column}>
                                  <span className="text-zinc-500">{c.column}: </span>
                                  <span className="text-zinc-400 line-through">{c.before ?? "(비어 있음)"}</span>
                                  <span className="mx-1 text-zinc-400">→</span>
                                  <mark className="rounded-sm bg-amber-100 px-0.5 text-zinc-900 dark:bg-amber-900/50 dark:text-zinc-100">{c.after ?? "(비어 있음)"}</mark>
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <IdList title={summary.key ? "새로 생긴 ID" : "새로 생긴 줄"} total={summary.added} items={detail.added} link={rowLink} />
          <IdList title={summary.key ? "사라진 ID" : "사라진 줄"} total={summary.removed} items={detail.removed} />
          {detail.changed.length === 0 && summary.added === 0 && summary.removed === 0 && (
            <p className="text-zinc-500">행 내용은 같고 컬럼만 바뀌었습니다.</p>
          )}
        </>
      )}
    </section>
  );
}

function IdList({ title, total, items, link }: { title: string; total: number; items: string[]; link?: (v: string) => string | null }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-zinc-500">
        {title} {total.toLocaleString()}개{total > items.length && ` (앞의 ${items.length}개만 표시)`}
      </h3>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
        {items.map((v, i) => {
          const href = link?.(v);
          const cls = "rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900";
          return href ? (
            <Link key={`${v}-${i}`} href={href} className={`${cls} text-blue-700 hover:border-zinc-400 dark:text-blue-400`}>
              {v}
            </Link>
          ) : (
            <span key={`${v}-${i}`} className={cls}>
              {v}
            </span>
          );
        })}
      </div>
    </div>
  );
}
