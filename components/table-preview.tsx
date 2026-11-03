"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { buildColumns, DataTable } from "@/components/data-table";
import { FollowTrail } from "@/components/follow/follow-trail";
import { useWorkspace } from "@/components/workspace-provider";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { linkedColumns, parseTrail, serializeTrail, toKeyValue, type TrailStep } from "@/lib/client/follow";
import { quoteIdent, quoteString, type QueryResult } from "@/lib/query-result";
import { TableLinks } from "@/components/table-links";
import { useLinkedRelations } from "@/components/use-auto-links";

const PREVIEW_LIMIT = 1000;

interface Preview {
  key: string;
  result: QueryResult;
  tableColumns: ReturnType<typeof buildColumns>;
  total: number;
}

export function TablePreview({ id, table }: { id: string; table: string }) {
  const { sources, initialized } = useWorkspace();
  const source = sources.find((s) => s.meta.id === id);
  const ready = source?.status === "ready" && source.tables.includes(table);
  const [loaded, setLoaded] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 표 안 검색. 입력 중인 값과 적용한 값을 나눠서, Enter를 눌렀을 때만 다시 조회한다.
  const [draft, setDraft] = useState({ text: "", column: "" });
  const [search, setSearch] = useState({ text: "", column: "", table: "" });
  const activeSearch = search.table === `${id}/${table}` ? search : { text: "", column: "", table: "" };
  // 다른 테이블로 옮겨 갔거나 검색이 바뀌었을 때 이전 결과를 잠깐이라도 보여주지 않도록 키로 거른다.
  const previewKey = JSON.stringify([id, table, activeSearch.text, activeSearch.column]);
  const preview = loaded?.key === previewKey ? loaded : null;
  // 열 목록은 검색 전 결과에서 기억해 둔다. 검색 결과가 0행이어도 열은 그대로다.
  const [columns, setColumns] = useState<{ key: string; names: string[] } | null>(null);
  const columnNames = columns?.key === `${id}/${table}` ? columns.names : [];

  // 따라가기 경로는 URL에 둔다. 새로고침하거나 주소를 나눠도 같은 위치가 열리고, 뒤로 가기로 이전 단계로 돌아간다.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const trail = parseTrail(searchParams.get("trail"));

  // router.push는 단계마다 서버에 요청하므로 브라우저 history만 바꾼다. Next 라우터가 searchParams를 맞춰 준다.
  function setTrail(next: TrailStep[]) {
    const query = next.length ? `?trail=${encodeURIComponent(serializeTrail(next))}` : "";
    window.history.pushState(null, "", `${pathname}${query}`);
  }

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const target = qualifiedTable(id, table);
    const { text, column } = activeSearch;
    (async () => {
      let where = "";
      if (text) {
        // 일부만 맞아도 찾는다. 열을 고르면 그 열에서만 찾는다.
        const cols = column ? [column] : columnNames;
        const pattern = quoteString(`%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where = `WHERE ${cols.map((c) => `CAST(${quoteIdent(c)} AS VARCHAR) ILIKE ${pattern} ESCAPE '\\'`).join(" OR ") || "false"}`;
      }
      const result = await runQuery(`SELECT * FROM ${target} ${where}`, PREVIEW_LIMIT);
      const count = await runQuery(`SELECT count(*) FROM ${target} ${where}`, 1);
      if (!active) return;
      if (!text) setColumns({ key: `${id}/${table}`, names: result.columns.map((c) => c.name) });
      setLoaded({
        key: previewKey,
        result,
        tableColumns: buildColumns(result.columns),
        total: Number(count.rows[0]?.[0] ?? 0),
      });
      setError(null);
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      active = false;
    };
    // 검색 조건과 테이블은 previewKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, ready]);

  const backHref = `/sources/${id}`;
  // 저장한 관계에 자동으로 찾은 연결을 더한다. 값 따라가기도 이 목록으로 동작한다.
  const links = useLinkedRelations([{ sourceId: id, table }]);
  const linked = linkedColumns(id, table, links.relations);

  if (!initialized || source?.status === "loading") {
    return <Loading />;
  }
  if (!ready) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">이 테이블을 찾을 수 없습니다.</p>
        <BackLink href={backHref} label={source?.meta.name ?? "데이터 소스"} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{table}</h1>
        {preview && (
          <p className="text-zinc-500">
            {activeSearch.text ? `찾은 행 ${preview.total.toLocaleString()}개` : `전체 ${preview.total.toLocaleString()}행`}, 열{" "}
            {preview.result.columns.length}개
            {preview.result.truncated &&
              ` (앞의 ${PREVIEW_LIMIT.toLocaleString()}행만 표시)`}
          </p>
        )}
        <form
          className="ml-auto flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ text: draft.text.trim(), column: draft.column, table: `${id}/${table}` });
          }}
        >
          <select
            aria-label="찾을 열"
            value={draft.column}
            onChange={(e) => setDraft((d) => ({ ...d, column: e.target.value }))}
            className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">모든 열</option>
            {columnNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="표 안에서 찾기 (Enter)"
            aria-label="표 안에서 찾기"
            className="w-56 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          {activeSearch.text && (
            <button
              type="button"
              onClick={() => {
                setDraft({ text: "", column: "" });
                setSearch({ text: "", column: "", table: "" });
              }}
              className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              지우기
            </button>
          )}
        </form>
      </div>

      <TableLinks
        sourceId={id}
        table={table}
        columns={columnNames}
        relations={links.relations}
        reasons={links.reasons}
        ready={links.ready}
      />
      {linked.size > 0 && trail.length === 0 && (
        <p className="-mt-1 text-xs text-zinc-500">표에서 파란 밑줄 값을 누르면 이어진 테이블의 행을 오른쪽에 열어 따라갈 수 있습니다.</p>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>데이터를 읽지 못했습니다.</p>
          <details className="mt-2">
            <summary className="cursor-pointer">자세히</summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs">{error}</pre>
          </details>
        </div>
      )}

      <div className={trail.length ? "flex flex-col gap-4 xl:flex-row" : ""}>
        <div className={trail.length ? "min-w-0 xl:w-[45%] xl:shrink-0" : ""}>
          {preview ? (
            <DataTable
              columns={preview.result.columns}
              tableColumns={preview.tableColumns}
              rows={preview.result.rows}
              linked={linked}
              onLinkClick={(column, value) => {
                const key = toKeyValue(value);
                if (key) setTrail([{ sourceId: id, table, column, ...key }]);
              }}
            />
          ) : (
            !error && <Loading />
          )}
        </div>
        {trail.length > 0 && <FollowTrail trail={trail} onChange={setTrail} />}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      불러오는 중...
    </p>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
