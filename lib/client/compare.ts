import { loadDbSnapshot } from "@/lib/client/db-import";
import { runQuery } from "@/lib/client/duckdb";
import { loadIntoDuckDB, previousSchemaName, previousTable, qualifiedTable } from "@/lib/client/file-import";
import { isFileSource, readPreviousFile, type SourceMeta } from "@/lib/client/opfs";
import { mostlyUnique, quoteIdent } from "@/lib/query-result";

// 패치 전후 비교(설계 4.9). 파일을 교체할 때 남겨 둔 이전 파일, 또는 개발 DB를 다시 불러오기 전에 남겨 둔 이전 상태(37단계)를
// p_<id> 스키마에 올리고, 지금 데이터(s_<id>)와 시트(테이블) 이름이 같은 것끼리 ID 열 기준으로 비교한다.

export const DETAIL_LIMIT = 300;

export type TableStatus = "same" | "changed" | "added" | "removed";

export interface TableSummary {
  table: string;
  status: TableStatus;
  key: string | null; // 비교에 쓴 ID 열. 없으면 줄 단위로 비교했다.
  oldRows: number;
  newRows: number;
  added: number; // 새로 생긴 행
  removed: number; // 사라진 행
  changed: number; // ID는 같고 값이 바뀐 행(ID 열이 있을 때만)
  addedColumns: string[];
  removedColumns: string[];
}

export interface ChangedRow {
  id: string;
  cells: { column: string; before: string | null; after: string | null }[];
}

export interface TableDetail {
  changed: ChangedRow[];
  added: string[]; // ID 목록(ID 열이 있을 때) 또는 줄 내용
  removed: string[];
}

// 숫자 1과 1.0, 글자 "1"을 같은 값으로 본다. 패치 사이에 열 종류(정수/실수)가 바뀌어도 바뀐 값으로 세지 않기 위해서다.
export function norm(expr: string) {
  const d = `TRY_CAST(${expr} AS DOUBLE)`;
  return `(CASE WHEN ${d} IS NOT NULL AND ${d} = floor(${d}) AND abs(${d}) < 1e15 THEN CAST(CAST(${d} AS BIGINT) AS VARCHAR) ELSE CAST(${expr} AS VARCHAR) END)`;
}

const num = (v: unknown) => Number(v ?? 0);

// 이전 파일은 비교할 때 한 번만 올린다. 같은 이전 파일이면 다시 올리지 않는다.
const loaded = new Map<string, Promise<string[]>>();

export function hasPrevious(meta: SourceMeta) {
  return !!meta.previous;
}

// 이전 버전을 부르는 말. 파일은 이전 파일 이름, DB는 그때 불러온 시각.
export function previousLabel(meta: SourceMeta) {
  if (!meta.previous) return "";
  if (isFileSource(meta)) return `이전 파일 ${meta.previous.fileName}`;
  const at = meta.previous.loadedAt ?? meta.previous.savedAt;
  return `${new Date(at).toLocaleString()}에 불러온 DB`;
}

export function loadPrevious(meta: SourceMeta): Promise<string[]> {
  if (!meta.previous) return Promise.resolve([]);
  const key = `${meta.id}|${meta.previous.savedAt}|${isFileSource(meta) ? meta.header : "db"}`;
  if (!loaded.has(key)) {
    const promise = isFileSource(meta)
      ? readPreviousFile(meta).then((file) =>
          // 이전 파일도 지금 파일과 같은 규칙(시트 이름, 첫 행 제목 여부)으로 테이블을 만든다.
          loadIntoDuckDB({ ...meta, fileName: meta.previous!.fileName }, file, previousSchemaName(meta.id)),
        )
      : loadDbSnapshot(meta);
    promise.catch(() => loaded.delete(key));
    loaded.set(key, promise);
  }
  return loaded.get(key)!;
}

async function columnsOf(target: string) {
  const r = await runQuery(`SELECT * FROM ${target} LIMIT 0`, 1);
  return r.columns.map((c) => c.name);
}

// ID 열: 첫 열이 두 버전 모두에 있고, 두 버전 모두에서 98% 이상 값이 겹치지 않으면 쓴다.
// 실제 데이터에는 실수로 들어간 중복 ID가 섞여 있곤 해서 100%를 요구하지 않는다.
async function pickKey(oldT: string, newT: string, oldCols: string[], newCols: string[]) {
  const first = newCols[0];
  if (!first || !oldCols.includes(first)) return null;
  const col = quoteIdent(first);
  for (const t of [oldT, newT]) {
    const r = await runQuery(`SELECT count(*), count(DISTINCT ${norm(col)}), count(${col}) FROM ${t}`, 1);
    const [n, distinct, nonNull] = (r.rows[0] ?? []).map(num);
    if (!mostlyUnique(n, distinct, nonNull)) return null;
  }
  return first;
}

// 중복 ID가 있으면 첫 줄만 남긴 뒤 비교한다. 같은 ID끼리 여러 번 짝지어져 바뀐 행이 부풀지 않게 하려는 것.
// 「첫 줄」은 파일(테이블)에 들어 있는 순서(rowid)다. ORDER BY가 없으면 DuckDB가 아무 줄이나 고를 수 있다.
function dedupedCte(name: string, target: string, key: string) {
  return `${name} AS (SELECT *, ${norm(quoteIdent(key))} AS __k FROM ${target} WHERE ${quoteIdent(key)} IS NOT NULL QUALIFY row_number() OVER (PARTITION BY ${norm(quoteIdent(key))} ORDER BY rowid) = 1)`;
}

function diffCondition(columns: string[]) {
  if (!columns.length) return "false";
  return columns.map((c) => `${norm(`o.${quoteIdent(c)}`)} IS DISTINCT FROM ${norm(`n.${quoteIdent(c)}`)}`).join(" OR ");
}

// 줄 단위 비교용: 공통 열을 한 줄 글자로 이어 붙인다.
function rowText(alias: string, columns: string[]) {
  return `concat_ws(' | ', ${columns.map((c) => `coalesce(${norm(`${alias}.${quoteIdent(c)}`)}, '(비어 있음)')`).join(", ")})`;
}

export async function compareSource(meta: SourceMeta, currentTables: string[]): Promise<TableSummary[]> {
  const oldTables = await loadPrevious(meta);
  const names = [...new Set([...currentTables, ...oldTables])];
  const out: TableSummary[] = [];
  for (const table of names) out.push(await summarize(meta, table, oldTables.includes(table), currentTables.includes(table)));
  return out;
}

// 테이블 하나만 비교한다. 테이블 화면의 「이번 패치에서 바뀐 행」처럼 소스 전체를 돌 필요가 없을 때 쓴다.
const summaryCache = new Map<string, Promise<TableSummary | null>>();

export function compareOne(meta: SourceMeta, table: string, currentTables: string[]): Promise<TableSummary | null> {
  if (!meta.previous) return Promise.resolve(null);
  const key = `${meta.id}|${meta.previous.savedAt}|${isFileSource(meta) ? `${meta.header}|${meta.replacedAt}` : meta.loadedAt}|${table}`;
  if (!summaryCache.has(key)) {
    const promise = loadPrevious(meta).then((oldTables) =>
      oldTables.includes(table) || currentTables.includes(table) ? summarize(meta, table, oldTables.includes(table), currentTables.includes(table)) : null,
    );
    promise.catch(() => summaryCache.delete(key));
    summaryCache.set(key, promise);
  }
  return summaryCache.get(key)!;
}

async function summarize(meta: SourceMeta, table: string, inOld: boolean, inNew: boolean): Promise<TableSummary> {
  const oldT = previousTable(meta.id, table);
  const newT = qualifiedTable(meta.id, table);
  const count = async (t: string) => num((await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${t}`, 1)).rows[0]?.[0]);
  if (!inOld || !inNew) {
    const rows = await count(inNew ? newT : oldT);
    return {
      table,
      status: inNew ? "added" : "removed",
      key: null,
      oldRows: inOld ? rows : 0,
      newRows: inNew ? rows : 0,
      added: inNew ? rows : 0,
      removed: inOld ? rows : 0,
      changed: 0,
      addedColumns: [],
      removedColumns: [],
    };
  }
  const oldCols = await columnsOf(oldT);
  const newCols = await columnsOf(newT);
  const common = newCols.filter((c) => oldCols.includes(c));
  const key = await pickKey(oldT, newT, oldCols, newCols);
  const [oldRows, newRows] = [await count(oldT), await count(newT)];
  let added = 0;
  let removed = 0;
  let changed = 0;
  if (key) {
    const r = await runQuery(
      `WITH ${dedupedCte("o", oldT, key)}, ${dedupedCte("n", newT, key)}
       SELECT
         (SELECT CAST(count(*) AS BIGINT) FROM n WHERE __k NOT IN (SELECT __k FROM o)),
         (SELECT CAST(count(*) AS BIGINT) FROM o WHERE __k NOT IN (SELECT __k FROM n)),
         (SELECT CAST(count(*) AS BIGINT) FROM o JOIN n USING (__k) WHERE ${diffCondition(common.filter((c) => c !== key))})`,
      1,
    );
    [added, removed, changed] = (r.rows[0] ?? []).map(num);
  } else if (common.length) {
    const r = await runQuery(
      `WITH o AS (SELECT ${rowText("t", common)} AS line FROM ${oldT} t), n AS (SELECT ${rowText("t", common)} AS line FROM ${newT} t)
       SELECT
         (SELECT CAST(count(*) AS BIGINT) FROM (SELECT line FROM n EXCEPT ALL SELECT line FROM o)),
         (SELECT CAST(count(*) AS BIGINT) FROM (SELECT line FROM o EXCEPT ALL SELECT line FROM n))`,
      1,
    );
    [added, removed] = (r.rows[0] ?? []).map(num);
  }
  const addedColumns = newCols.filter((c) => !oldCols.includes(c));
  const removedColumns = oldCols.filter((c) => !newCols.includes(c));
  const same = added + removed + changed === 0 && !addedColumns.length && !removedColumns.length;
  return { table, status: same ? "same" : "changed", key, oldRows, newRows, added, removed, changed, addedColumns, removedColumns };
}

export async function compareTable(meta: SourceMeta, summary: TableSummary): Promise<TableDetail> {
  const { table, key, status } = summary;
  const oldT = previousTable(meta.id, table);
  const newT = qualifiedTable(meta.id, table);
  if (status === "added" || status === "removed") return { changed: [], added: [], removed: [] };
  const oldCols = await columnsOf(oldT);
  const newCols = await columnsOf(newT);
  const common = newCols.filter((c) => oldCols.includes(c));
  const strings = (rows: unknown[][]) => rows.map((r) => (r[0] === null || r[0] === undefined ? "" : String(r[0])));

  if (!key) {
    const lines = (a: string, b: string) =>
      runQuery(
        `WITH o AS (SELECT ${rowText("t", common)} AS line FROM ${oldT} t), n AS (SELECT ${rowText("t", common)} AS line FROM ${newT} t)
         SELECT line FROM (SELECT line FROM ${a} EXCEPT ALL SELECT line FROM ${b}) LIMIT ${DETAIL_LIMIT}`,
        DETAIL_LIMIT,
      );
    return { changed: [], added: strings((await lines("n", "o")).rows), removed: strings((await lines("o", "n")).rows) };
  }

  const ctes = `WITH ${dedupedCte("o", oldT, key)}, ${dedupedCte("n", newT, key)}`;
  const ids = (a: string, b: string) => runQuery(`${ctes} SELECT __k FROM ${a} WHERE __k NOT IN (SELECT __k FROM ${b}) ORDER BY __k LIMIT ${DETAIL_LIMIT}`, DETAIL_LIMIT);
  const valueCols = common.filter((c) => c !== key);
  const changed: ChangedRow[] = [];
  if (valueCols.length) {
    const select = valueCols.flatMap((c) => [norm(`o.${quoteIdent(c)}`), norm(`n.${quoteIdent(c)}`)]).join(", ");
    const r = await runQuery(
      `${ctes} SELECT __k, ${select} FROM o JOIN n USING (__k) WHERE ${diffCondition(valueCols)} ORDER BY __k LIMIT ${DETAIL_LIMIT}`,
      DETAIL_LIMIT,
    );
    for (const row of r.rows) {
      const cells: ChangedRow["cells"] = [];
      valueCols.forEach((column, i) => {
        const before = row[1 + i * 2] as string | null;
        const after = row[2 + i * 2] as string | null;
        if (before !== after) cells.push({ column, before, after });
      });
      changed.push({ id: String(row[0]), cells });
    }
  }
  return { changed, added: strings((await ids("n", "o")).rows), removed: strings((await ids("o", "n")).rows) };
}

export interface BrokenUse {
  table: string; // 사라진 ID를 아직 쓰는 테이블 키(소스 id/테이블)
  column: string; // 그 테이블의 열
  rows: number; // 사라진 ID를 쓰는 행 수
  ids: string[]; // 그중 일부 ID
}

// "이 변경으로 깨지는 곳": 사라진 ID를 다른 테이블이 아직 쓰고 있는지 센다.
// users는 이 테이블의 ID 열을 쓰는 연결(도메인 모델의 in 목록 중 ID 열로 이어진 것)이다.
export async function brokenUses(
  meta: SourceMeta,
  summary: TableSummary,
  users: { key: string; column: string }[],
): Promise<BrokenUse[]> {
  if (!summary.key || summary.removed === 0) return [];
  const ctes = `WITH ${dedupedCte("o", previousTable(meta.id, summary.table), summary.key)}, ${dedupedCte("n", qualifiedTable(meta.id, summary.table), summary.key)},
    gone AS (SELECT __k FROM o WHERE __k NOT IN (SELECT __k FROM n))`;
  const out: BrokenUse[] = [];
  for (const u of users) {
    const slash = u.key.indexOf("/");
    const target = qualifiedTable(u.key.slice(0, slash), u.key.slice(slash + 1));
    const col = norm(`r.${quoteIdent(u.column)}`);
    try {
      const r = await runQuery(
        `${ctes}, used AS (SELECT ${col} AS v FROM ${target} r WHERE ${col} IN (SELECT __k FROM gone))
         SELECT CAST(count(*) AS BIGINT), (SELECT string_agg(v, ',') FROM (SELECT DISTINCT v FROM used ORDER BY v LIMIT 20)) FROM used`,
        1,
      );
      const rows = num(r.rows[0]?.[0]);
      if (rows > 0) {
        const ids = String(r.rows[0]?.[1] ?? "").split(",").filter(Boolean);
        out.push({ table: u.key, column: u.column, rows, ids });
      }
    } catch {
      // 상대 테이블을 읽지 못하면(파일이 아직 적재 중 등) 그 연결만 건너뛴다.
    }
  }
  return out.sort((a, b) => b.rows - a.rows);
}


export interface PatchIds {
  key: string; // ID 열
  added: string[]; // 새로 생긴 ID
  changed: string[]; // 값이 바뀐 ID
  truncated: boolean; // PATCH_ID_LIMIT에서 잘렸는지
}

export const PATCH_ID_LIMIT = 5000;

// 「바뀐 Id 목록을 다른 화면에서 쓰기」(37단계). 테이블 화면 거르기와 패치 테스트 항목이 쓴다.
// 값은 norm()으로 맞춘 글자라 화면에서도 norm()으로 비교해야 한다.
export async function patchIds(meta: SourceMeta, summary: TableSummary): Promise<PatchIds | null> {
  const { table, key } = summary;
  if (!key || summary.status !== "changed") return null;
  await loadPrevious(meta);
  const ctes = `WITH ${dedupedCte("o", previousTable(meta.id, table), key)}, ${dedupedCte("n", qualifiedTable(meta.id, table), key)}`;
  const oldCols = await columnsOf(previousTable(meta.id, table));
  const valueCols = (await columnsOf(qualifiedTable(meta.id, table))).filter((c) => c !== key && oldCols.includes(c));
  const list = async (sql: string) => (await runQuery(sql, PATCH_ID_LIMIT)).rows.map((r) => String(r[0]));
  const added = await list(`${ctes} SELECT __k FROM n WHERE __k NOT IN (SELECT __k FROM o) ORDER BY __k`);
  const changed = valueCols.length ? await list(`${ctes} SELECT __k FROM o JOIN n USING (__k) WHERE ${diffCondition(valueCols)} ORDER BY __k`) : [];
  return { key, added, changed, truncated: added.length >= PATCH_ID_LIMIT || changed.length >= PATCH_ID_LIMIT };
}
