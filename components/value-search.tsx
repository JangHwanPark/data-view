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
        불러온 모든 파일의 모든 열에서 찾습니다. 아이템 ID를 넣으면 아이템 테이블뿐 아니라 그 ID를 쓰는 보상, 상점, 제작 테이블의 행도 함께 나옵니다. 기본은 값 전체가 같은 경우만 찾고, 포함 검색을 켜면 일부만 맞아도 찾습니다.
      </p>

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
                    {hit.result.truncated ? "+" : ""}행, 맞은 열: {matchedColumns.join(", ")}
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
