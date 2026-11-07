"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { buildColumns, DataTable } from "@/components/data-table";
import { FollowTrail } from "@/components/follow/follow-trail";
import { RowTreePanel } from "@/components/row-tree/row-tree-panel";
import { ColumnHeaderInfo, useColumnProfiles } from "@/components/column-info";
import { useWorkspace } from "@/components/workspace-provider";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable, tableRules } from "@/lib/client/file-import";
import { focusKey, focusWhere, parseRowFocus, tableHref, type RowFocus } from "@/lib/client/doc-links";
import { columnSeparators, linkedColumns, parseTrail, serializeTrail, toKeyValue, type TrailStep } from "@/lib/client/follow";
import { quoteIdent, quoteString, type QueryResult } from "@/lib/query-result";
import { TableDomainLine } from "@/components/map/table-domain-line";
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

  // 따라가기 경로는 URL에 둔다. 새로고침하거나 주소를 나눠도 같은 위치가 열리고, 뒤로 가기로 이전 단계로 돌아간다.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const trailParam = searchParams.get("trail");
  const trail = parseTrail(trailParam);
  // 기획서에서 ID를 눌러 왔으면 그 행만 보여준다(row 쿼리).
  const rowParam = searchParams.get("row");
  const focus = parseRowFocus(rowParam);

  // 다른 테이블로 옮겨 갔거나 검색이 바뀌었을 때 이전 결과를 잠깐이라도 보여주지 않도록 키로 거른다.
  const previewKey = JSON.stringify([id, table, activeSearch.text, activeSearch.column, focus]);
  const preview = loaded?.key === previewKey ? loaded : null;
  // 열 목록은 검색 전 결과에서 기억해 둔다. 검색 결과가 0행이어도 열은 그대로다.
  const [columns, setColumns] = useState<{ key: string; names: string[] } | null>(null);
  const columnNames = columns?.key === `${id}/${table}` ? columns.names : [];

  // router.push는 단계마다 서버에 요청하므로 브라우저 history만 바꾼다. Next 라우터가 searchParams를 맞춰 준다.
  // 기획서에서 연 행은 따라가기 중에도 유지하고, 그때는 패널을 닫은 상태(trail=[])도 주소에 남긴다.
  // 그래야 아래의 "처음 열 때 따라가기 패널 띄우기"가 닫은 패널을 다시 열지 않는다.
  function setTrail(next: TrailStep[], replace = false) {
    const params = new URLSearchParams();
    // 관계도의 "데이터" 단추로 왔으면 view=data를 남겨, 따라가기를 닫아도 데이터 보기에 머문다.
    const viewParam = searchParams.get("view");
    if (viewParam) params.set("view", viewParam);
    if (rowParam) params.set("row", rowParam);
    if (next.length || rowParam) params.set("trail", serializeTrail(next));
    const query = params.size ? `?${params}` : "";
    window.history[replace ? "replaceState" : "pushState"](null, "", `${pathname}${query}`);
  }

  // 행 트리(설계 4.9). 행 번호를 누르면 그 행이 쓰는 것과 그 행을 쓰는 곳을 오른쪽에 트리로 연다.
  // 따라가기 패널과 같은 자리를 쓰므로 하나를 열면 다른 하나는 닫는다.
  const tree = parseRowFocus(searchParams.get("tree"));
  const treeMode = searchParams.get("treeMode") === "usedBy" ? "usedBy" : "uses";
  function setTree(next: RowFocus | null, mode: "uses" | "usedBy" = "uses") {
    const params = new URLSearchParams();
    const viewParam = searchParams.get("view");
    if (viewParam) params.set("view", viewParam);
    if (rowParam) params.set("row", rowParam);
    if (next) {
      params.set("tree", JSON.stringify(next));
      if (mode === "usedBy") params.set("treeMode", "usedBy");
    }
    // 기획서에서 연 행이 있으면 따라가기 패널이 저절로 다시 열리지 않도록 닫힌 상태를 남긴다.
    if (rowParam) params.set("trail", "[]");
    window.history.pushState(null, "", `${pathname}?${params}`);
  }

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const target = qualifiedTable(id, table);
    const { text, column } = activeSearch;
    (async () => {
      const conditions: string[] = [];
      if (text) {
        // 일부만 맞아도 찾는다. 열을 고르면 그 열에서만 찾는다.
        const cols = column ? [column] : columnNames;
        const pattern = quoteString(`%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        conditions.push(`(${cols.map((c) => `CAST(${quoteIdent(c)} AS VARCHAR) ILIKE ${pattern} ESCAPE '\\'`).join(" OR ") || "false"})`);
      }
      // 기획서에서 연 행. 이 테이블에 그 열이 없으면(이름이 바뀐 열) 걸러지지 않은 표와 안내를 보여준다.
      const names = columnNames.length ? columnNames : await tableColumnNames(target);
      if (focus && names.includes(focus.column)) conditions.push(focusWhere(focus));
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await runQuery(`SELECT * FROM ${target} ${where}`, PREVIEW_LIMIT);
      const count = await runQuery(`SELECT count(*) FROM ${target} ${where}`, 1);
      if (!active) return;
      setColumns({ key: `${id}/${table}`, names: result.columns.map((c) => c.name) });
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
  // 열 정보 줄(설계 6.2): 열마다 빈 칸, 값 종류, ID 열 여부를 센다.
  const { profiles, version: profileVersion } = useColumnProfiles(id, table, columnNames, ready);
  const focusColumnMissing = focus !== null && columnNames.length > 0 && !columnNames.includes(focus.column);

  // 기획서에서 행을 열고 들어오면, 그 키 열에 이어진 테이블이 있을 때 따라가기 패널을 바로 띄운다.
  // 퀘스트 ID라면 그 퀘스트를 가리키는 보상, 조건 행이 오른쪽에 열린다. 주소를 바꾸는 것이라 뒤로 가기 기록은 남기지 않는다.
  const autoTrail = focus !== null && trailParam === null && !tree && links.ready && linked.has(focus.column);
  useEffect(() => {
    if (!autoTrail || !focus) return;
    setTrail([{ sourceId: id, table, column: focus.column, ...focusKey(focus) }], true);
    // focus와 테이블은 autoTrail 계산에 들어 있고, 한 번 띄운 뒤에는 trail 쿼리가 생겨 다시 돌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrail]);

  if (!initialized || source?.status === "loading") {
    return <Loading />;
  }
  if (!ready) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">이 테이블을 찾을 수 없습니다.</p>
        <BackLink href={backHref} label={source?.meta.name ?? "불러온 파일"} />
      </div>
    );
  }

  // ;로 막은 비활성 행(23단계). 표에는 줄을 그어 남기고 행 수에서는 뺀다.
  const inactiveCount = tableRules(id, table)?.inactive.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{table}</h1>
        {preview && (
          <p className="text-zinc-500">
            {activeSearch.text || (focus && !focusColumnMissing)
              ? `찾은 행 ${preview.total.toLocaleString()}개`
              : inactiveCount > 0
                ? `쓰는 행 ${(preview.total - inactiveCount).toLocaleString()}행(비활성 ${inactiveCount.toLocaleString()}행 빼고)`
                : `전체 ${preview.total.toLocaleString()}행`}
            , 컬럼{" "}
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
            aria-label="찾을 컬럼"
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

      <TableDomainLine sourceId={id} table={table} />
      <TableLinks
        focus={focus}
        sourceId={id}
        table={table}
        columns={columnNames}
        relations={links.relations}
        reasons={links.reasons}
        ready={links.ready}
      />
      {focus && (
        <FocusBanner
          focus={focus}
          rows={preview?.total ?? null}
          missingColumn={focusColumnMissing}
          noLinks={links.ready && !linked.has(focus.column)}
          allHref={tableHref(id, table)}
        />
      )}
      {linked.size > 0 && trail.length === 0 && !focus && (
        <p className="-mt-1 text-xs text-zinc-500">표에서 파란 밑줄 값을 누르면 이어진 테이블의 행을 오른쪽에 열어 따라갈 수 있습니다. 행 번호를 누르면 그 행의 참조 대상과 그 행을 참조하는 곳을 트리로 봅니다.</p>
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

      <div className={trail.length || tree ? "flex flex-col gap-4 xl:flex-row" : ""}>
        <div className={tree ? "min-w-0 flex-1" : trail.length ? "min-w-0 xl:w-[45%] xl:shrink-0" : ""}>
          {preview ? (
            <DataTable
              columns={preview.result.columns}
              tableColumns={preview.tableColumns}
              rows={preview.result.rows}
              linked={linked}
              sourceKey={`${id}/${table}`}
              separators={columnSeparators(id, table, links.relations)}
              onLinkClick={(column, value) => {
                const key = toKeyValue(value);
                if (key) setTrail([{ sourceId: id, table, column, ...key }]);
              }}
              headerInfo={(column) => (
                <ColumnHeaderInfo sourceId={id} table={table} column={column} profile={profiles?.get(column.name)} version={profileVersion} />
              )}
              onRowClick={(row) => {
                const first = preview.result.columns[0]?.name;
                if (first && row[0] !== null && row[0] !== undefined) setTree({ column: first, value: String(row[0]).replace(/^(-?\d+)\.0+$/, "$1") });
              }}
            />
          ) : (
            !error && <Loading />
          )}
        </div>
        {tree ? (
          <RowTreePanel
            here={`${id}/${table}`}
            column={tree.column}
            value={tree.value}
            mode={treeMode}
            onMode={(m) => setTree(tree, m)}
            onClose={() => setTree(null)}
          />
        ) : (
          trail.length > 0 && <FollowTrail trail={trail} onChange={setTrail} />
        )}
      </div>
    </div>
  );
}

async function tableColumnNames(target: string) {
  const r = await runQuery(`SELECT * FROM ${target} LIMIT 0`, 1);
  return r.columns.map((c) => c.name);
}

interface FocusProps {
  focus: { column: string; value: string };
  rows: number | null;
  missingColumn: boolean;
  noLinks: boolean;
  allHref: string;
}

// 기획서에서 연 행의 안내 줄. 행이 없으면 기획서가 옛 값이거나 데이터가 빠졌다는 신호라 주황으로 보여준다.
function FocusBanner({ focus, rows, missingColumn, noLinks, allHref }: FocusProps) {
  const warn = missingColumn || rows === 0;
  return (
    <div
      className={`-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1.5 text-xs ${warn ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"}`}
    >
      <span>
        고른 행: <span className="font-medium">{focus.column} = {focus.value}</span>
      </span>
      {missingColumn ? (
        <span>이 테이블에 {focus.column} 컬럼이 없습니다. 컬럼 이름이 바뀌었을 수 있어 표 전체를 보여줍니다.</span>
      ) : rows === 0 ? (
        <span>이 값의 행이 테이블에 없습니다. 기획서나 다른 테이블이 지워진 ID를 쓰고 있거나 데이터가 빠졌을 수 있습니다.</span>
      ) : rows !== null ? (
        <span className="opacity-80">
          {rows.toLocaleString()}행{noLinks ? `. ${focus.column}을 참조하는 테이블은 없습니다. 행의 파란 밑줄 값을 누르면 이어진 테이블을 따라갑니다.` : ""}
        </span>
      ) : null}
      <Link href={allHref} className="ml-auto underline underline-offset-2">
        전체 행 보기
      </Link>
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
