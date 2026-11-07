"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { RecordTable } from "@/components/record-table";
import { sourceTableLabel } from "@/components/relations/relation-parts";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { columnSeparators, linkedColumns, serializeTrail, toKeyValue } from "@/lib/client/follow";
import { loadColumns } from "@/lib/client/schema";
import { searchValue, SEARCH_ROW_LIMIT, type SearchHit, type SearchMode } from "@/lib/client/search";
import { TableName } from "@/components/table-name";
import { tableHref } from "@/lib/client/doc-links";
import { ensureValueIndex, suggestValues, SUGGEST_LIMIT, type Suggestion } from "@/lib/client/value-index";
import { splitMatches } from "@/components/docs/doc-original";

export function ValueSearch() {
  const { sources, relations, initialized } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 검색어는 URL에 둔다. 결과에서 다른 화면으로 갔다가 돌아와도 그대로 남는다.
  const query = searchParams.get("q") ?? "";
  const mode: SearchMode = searchParams.get("mode") === "contains" ? "contains" : "exact";

  const [input, setInput] = useState(query);
  const [contains, setContains] = useState(mode === "contains");
  const [loaded, setLoaded] = useState<{ key: string; hits: SearchHit[] | "error" } | null>(null);

  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const readyKey = ready.map(sourceVersion).join("|");
  const requestKey = JSON.stringify([query, mode, readyKey]);
  const hits = loaded?.key === requestKey ? loaded.hits : null;

  useEffect(() => {
    if (!query || loading) return;
    let active = true;
    (async () => {
      const columns = await loadColumns();
      const tables = ready.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
      return searchValue(tables, columns, query, mode);
    })()
      .then((result) => active && setLoaded({ key: requestKey, hits: result }))
      .catch(() => active && setLoaded({ key: requestKey, hits: "error" }));
    return () => {
      active = false;
    };
    // ready는 readyKey에, 검색 조건은 requestKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, loading]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const params = new URLSearchParams({ q });
    if (contains) params.set("mode", "contains");
    // 검색은 브라우저 안에서만 하므로 서버 요청 없이 URL만 바꾼다.
    window.history.pushState(null, "", `${pathname}?${params}`);
  }

  const total = Array.isArray(hits) ? hits.reduce((sum, h) => sum + h.result.rowCount, 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">ID·값 찾기</h1>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="찾을 ID나 값 (예: 아이템 ID 100041)"
          aria-label="찾을 값"
          className="w-80 max-w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          autoComplete="off"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={contains} onChange={(e) => setContains(e.target.checked)} />
          포함 검색
        </label>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Search className="size-4" aria-hidden />
          검색
        </button>
      </form>
      <p className="-mt-3 text-xs text-zinc-500">
        불러온 모든 파일의 모든 컬럼에서 찾습니다. 치는 동안 아래에 맞는 값이 바로 나오고(같은 값 → 앞부분이 같은 값 → 들어 있는 값, 짧은 값 먼저), 하나를 고르면 그 테이블을 그 값으로 거른 화면이 열립니다.
        검색을 누르면 그 값이 나오는 모든 행을 테이블마다 보여줍니다. 기본은 값 전체가 같은 경우만 찾고, 포함 검색을 켜면 일부만 맞아도 찾습니다.
      </p>
      <ValueSuggestions input={input} ready={!loading} readyKey={readyKey} sources={ready} />

      {query && (loading || !hits) && (
        <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          찾는 중...
        </p>
      )}
      {hits === "error" && <p className="text-sm text-red-600">검색하지 못했습니다.</p>}
      {Array.isArray(hits) && hits.length === 0 && (
        <p className="text-sm text-zinc-500">&lsquo;{query}&rsquo; 값을 찾지 못했습니다.</p>
      )}

      {Array.isArray(hits) && hits.length > 0 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-zinc-500">
            {hits.length}개 시트에서 {total.toLocaleString()}행을 찾았습니다.
          </p>
          {hits.map((hit) => {
            const source = sources.find((s) => s.meta.id === hit.sourceId);
            const href = `/sources/${hit.sourceId}/tables/${encodeURIComponent(hit.table)}`;
            const matchedColumns = [...new Set(hit.matched.flat())];
            return (
              <section key={`${hit.sourceId}/${hit.table}`} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <Link href={href} className="font-medium hover:underline">
                    {sourceTableLabel(source, hit.table)}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {hit.result.rowCount}
                    {hit.result.truncated ? "+" : ""}행, 맞은 컬럼: {matchedColumns.join(", ")}
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <RecordTable
                    result={hit.result}
                    sourceKey={`${hit.sourceId}/${hit.table}`}
                    separators={columnSeparators(hit.sourceId, hit.table, relations)}
                    linked={linkedColumns(hit.sourceId, hit.table, relations)}
                    highlighted={(column, r) => hit.matched[r]?.includes(column) ?? false}
                    onLinkClick={(column, value) => {
                      const key = toKeyValue(value);
                      if (!key) return;
                      const trail = serializeTrail([{ sourceId: hit.sourceId, table: hit.table, column, ...key }]);
                      router.push(`${href}?trail=${encodeURIComponent(trail)}`);
                    }}
                  />
                </div>
                {hit.result.truncated && (
                  <p className="text-xs text-zinc-500">앞의 {SEARCH_ROW_LIMIT}행만 보여줍니다.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

const RANK_LABEL = ["같은 값", "앞부분이 같은 값", "들어 있는 값"] as const;

// 값 찾기 색인으로 치는 동안 맞는 값을 보여준다(27단계, 3-11). 고르면 그 테이블을 그 열 = 값으로 거른다.
function ValueSuggestions({ input, ready, readyKey, sources }: { input: string; ready: boolean; readyKey: string; sources: ReturnType<typeof useWorkspace>["sources"] }) {
  const [index, setIndex] = useState<{ key: string; values: number; ms: number } | "error" | null>(null);
  const [result, setResult] = useState<{ q: string; items: Suggestion[]; total: number } | null>(null);
  const indexReady = index !== null && index !== "error" && index.key === readyKey;
  const q = input.trim();

  useEffect(() => {
    if (!ready || !readyKey) return;
    let active = true;
    (async () => {
      const columns = await loadColumns();
      const tables = sources.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
      return ensureValueIndex(readyKey, tables, columns);
    })()
      .then((r) => active && setIndex({ key: readyKey, ...r }))
      .catch(() => active && setIndex("error"));
    return () => {
      active = false;
    };
    // sources는 readyKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, readyKey]);

  // 칠 때마다 묻지 않고 잠깐 멈추면 묻는다.
  useEffect(() => {
    if (!indexReady || !q) return;
    let active = true;
    const timer = setTimeout(() => {
      suggestValues(q)
        .then((r) => active && setResult({ q, ...r }))
        .catch(() => active && setResult({ q, items: [], total: 0 }));
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, indexReady]);

  if (index === "error") return <p className="-mt-3 text-xs text-red-600">값 찾기 색인을 만들지 못했습니다. 검색 단추로 찾을 수 있습니다.</p>;
  if (!indexReady) {
    return ready && readyKey ? (
      <p className="-mt-3 inline-flex items-center gap-1 text-xs text-zinc-500">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        값 찾기 색인을 만드는 중
      </p>
    ) : null;
  }
  const shown = result && result.q === q ? result : null;
  return (
    <div className="-mt-3 flex flex-col gap-1.5">
      <p className="text-xs text-zinc-400">
        색인: 서로 다른 값 {index.values.toLocaleString()}개 ({(index.ms / 1000).toFixed(1)}초)
      </p>
      {q && shown && (
        <div className="rounded-md border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-label="맞는 값">
          {shown.items.length === 0 ? (
            <p className="px-3 py-2 text-zinc-500">&lsquo;{q}&rsquo;가 들어 있는 값이 없습니다.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {shown.items.map((s, i) => (
                <li key={`${s.sourceId}/${s.table}/${s.column}/${s.value}`}>
                  {(i === 0 || shown.items[i - 1].rank !== s.rank) && (
                    <p className="border-t border-zinc-100 bg-zinc-50 px-3 py-0.5 text-[11px] text-zinc-500 first:border-t-0 dark:border-zinc-800 dark:bg-zinc-800/50">{RANK_LABEL[s.rank]}</p>
                  )}
                  <Link
                    href={tableHref(s.sourceId, s.table, { column: s.column, value: s.value })}
                    className="flex flex-wrap items-baseline gap-x-2 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    title="누르면 이 테이블을 이 값으로 거른 화면을 엽니다"
                  >
                    <span className="font-mono">
                      {splitMatches(s.value, q).map((p, k) =>
                        p.hit ? (
                          <mark key={k} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-800/60">
                            {p.text}
                          </mark>
                        ) : (
                          <span key={k}>{p.text}</span>
                        ),
                      )}
                    </span>
                    <TableName sourceId={s.sourceId} table={s.table} className="text-zinc-600 dark:text-zinc-300" />
                    <span className="text-xs text-zinc-500">
                      {s.column} · {s.rows.toLocaleString()}행
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shown.total > shown.items.length && (
            <p className="border-t border-zinc-100 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800">
              {shown.total.toLocaleString()}개 중 앞 {SUGGEST_LIMIT}개. 더 좁히려면 더 길게 치세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
