"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { tablePath } from "@/core/ui/map-parts";
import { useKoreanNames } from "@/core/ui/use-korean-names";
import type { WorkspaceSource } from "@/core/ui/workspace-provider";
import { findUnused, type BrokenDesignRef, type SimilarPair, type UnusedResult } from "./data-checks";
import { tableHref } from "@/core/doc-links";
import type { DomainModel } from "@/core/domain-model";

// 데이터 점검 넓히기(35단계)의 세 화면. 없는 ID 찾기 화면의 탭으로 들어간다.

const tableOf = (key: string) => key.slice(key.indexOf("/") + 1);
const unusedCache = new Map<string, UnusedResult[]>();

export function useUnused(model: DomainModel | null, version: string, active: boolean) {
  const key = model ? `${version}|${[...model.tables.values()].map((t) => `${t.key}:${t.in.length}`).join(",")}` : null;
  const [state, setState] = useState<{ key: string; done: number; total: number; list: UnusedResult[] | null } | null>(null);
  useEffect(() => {
    if (!active || !key || !model || unusedCache.has(key)) return;
    let alive = true;
    (async () => {
      const keys = [...model.tables.values()].filter((t) => t.in.length).map((t) => t.key);
      const list: UnusedResult[] = [];
      for (const [i, k] of keys.entries()) {
        if (!alive) return;
        setState({ key, done: i, total: keys.length, list: null });
        const r = await findUnused(model, k).catch(() => null);
        if (r && r.unused > 0) list.push(r);
      }
      list.sort((a, b) => b.unused - a.unused);
      unusedCache.set(key, list);
      if (alive) setState({ key, done: keys.length, total: keys.length, list });
    })();
    return () => {
      alive = false;
    };
    // 모델은 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  if (!key) return null;
  const cached = unusedCache.get(key);
  if (cached) return { done: 1, total: 1, list: cached };
  return state?.key === key ? state : null;
}

export function UnusedPanel({ result }: { result: ReturnType<typeof useUnused> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const names = useKoreanNames();
  return (
    <>
      <p className="text-zinc-600 dark:text-zinc-400">
        다른 테이블이 참조하는 테이블에서, 어느 참조하는 곳도 쓰지 않는 Id입니다. 예: 어떤 보상·상점·제작에도 나오지 않는 아이템. 일부러 남긴 것일 수도 있지만, 지급 경로가 빠진 데이터일 수 있어 확인할 만합니다.
        ;로 막아 둔 비활성 행은 쓰지 않는 것이 맞으므로 따로 셉니다. 확인한 참조 관계와 앱이 찾은 참조 관계를 모두 봅니다.
      </p>
      {!result || !result.list ? (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {result ? `${result.done}/${result.total} 테이블 확인 중` : "확인을 시작하는 중"}
        </p>
      ) : result.list.length === 0 ? (
        <p className="text-zinc-500">모든 Id를 어딘가에서 쓰고 있습니다.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {result.list.map((r) => {
            const isOpen = open.has(r.key);
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            const { sourceId, table } = { sourceId: r.key.slice(0, r.key.indexOf("/")), table: tableOf(r.key) };
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setOpen((p) => (p.has(r.key) ? new Set([...p].filter((x) => x !== r.key)) : new Set([...p, r.key])))}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                >
                  <Chevron className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                  <span className="font-medium">{table}</span>
                  {names.get(r.key) && <span className="text-zinc-500">{names.get(r.key)!.text}</span>}
                  <span className="min-w-0 flex-1 truncate text-zinc-400" title={r.referrers.join(", ")}>
                    ← {r.referrers.slice(0, 3).join(", ")}
                    {r.referrers.length > 3 ? ` 외 ${r.referrers.length - 3}곳` : ""}
                  </span>
                  <span className="tabular-nums text-amber-700 dark:text-amber-400">
                    쓰지 않는 Id {r.unused.toLocaleString()}개 / {r.rows.toLocaleString()}행
                  </span>
                  {r.inactiveUnused > 0 && <span className="text-zinc-400">비활성 {r.inactiveUnused}개 따로</span>}
                </button>
                {isOpen && (
                  <div className="flex flex-wrap gap-1.5 bg-zinc-50/60 px-3 py-2 dark:bg-zinc-800/30">
                    {r.top.map((v) => (
                      <Link key={v} href={`${tableHref(sourceId, table, { column: r.column, value: v })}&view=data`} className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
                        {v}
                      </Link>
                    ))}
                    {r.unused > r.top.length && <span className="text-zinc-500">앞 {r.top.length}개만 보여줍니다.</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function DesignRefPanel({ list, sources }: { list: BrokenDesignRef[]; sources: WorkspaceSource[] }) {
  return (
    <>
      <p className="text-zinc-600 dark:text-zinc-400">
        엑셀 #Design 설명의 &lt;테이블&gt;이 불러온 데이터에 없는 곳입니다. 테이블 이름 오타이거나, 이름이 바뀐 옛 테이블이거나, 아직 불러오지 않은 파일일 수 있습니다.
      </p>
      {list.length === 0 ? (
        <p className="text-zinc-500">기획 설명이 가리키는 테이블이 모두 있습니다.</p>
      ) : (
        <table className="w-full rounded-md border border-zinc-200 bg-white text-left text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-1.5 font-medium">설명이 있는 곳</th>
              <th className="px-3 py-1.5 font-medium">가리키는 테이블</th>
              <th className="px-3 py-1.5 font-medium">비슷한 이름</th>
              <th className="px-3 py-1.5 font-medium">설명</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => {
              const similarKey = b.similar ? sources.flatMap((s) => s.tables.map((t) => `${s.meta.id}/${t}`)).find((k) => tableOf(k) === b.similar) : null;
              return (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-1.5">
                    <Link href={`${tablePath(b.key)}?view=columns`} className="font-medium hover:underline">
                      {tableOf(b.key)}
                    </Link>
                    <span className="font-mono text-zinc-500">.{b.column}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-red-700 dark:text-red-400">{b.target} (없음)</td>
                  <td className="px-3 py-1.5">
                    {similarKey ? (
                      <Link href={tablePath(similarKey)} className="text-blue-700 hover:underline dark:text-blue-400">
                        {b.similar}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{b.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function SimilarNamePanel({ list, rowCounts }: { list: SimilarPair[]; rowCounts: Map<string, number> }) {
  const names = useKoreanNames();
  return (
    <>
      <p className="text-zinc-600 dark:text-zinc-400">
        이름에서 낱말 하나가 한두 글자만 다른 테이블 쌍입니다(그 낱말이 8글자 미만이면 한 글자, 숫자만 다른 것은 뺍니다). 오타로 만든 옛 시트가 남아 있거나, 같은 데이터를 두 곳에서 고치고 있을 수 있습니다. 기획 설명 머리말까지 같으면 더 의심스럽습니다.
      </p>
      {list.length === 0 ? (
        <p className="text-zinc-500">이름이 비슷한 테이블 쌍이 없습니다.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {list.map((p) => (
            <li key={`${p.a}|${p.b}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              {[p.a, p.b].map((k, i) => (
                <span key={k} className="inline-flex items-center gap-1">
                  {i === 1 && <span className="text-zinc-400">↔</span>}
                  <Link href={tablePath(k)} className="font-mono font-medium hover:underline">
                    {tableOf(k)}
                  </Link>
                  <span className="text-zinc-500">
                    {names.get(k)?.text ? `${names.get(k)!.text} · ` : ""}
                    {rowCounts.get(k)?.toLocaleString() ?? "?"}행
                  </span>
                </span>
              ))}
              <span className="ml-auto text-amber-700 dark:text-amber-400">
                {p.distance}글자 다름{p.sameTitle ? ` · 머리말도 같음(${p.sameTitle})` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
