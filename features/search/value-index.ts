import { execute, runQuery } from "@/core/duckdb";
import { qualifiedTable } from "@/core/file-import";
import { tableKey } from "@/core/schema";
import { quoteIdent, quoteString, type QueryColumn } from "@/shared/lib/query-result";

// 값 찾기 색인(PLAN.md 27단계, 3-11). 불러온 모든 테이블의 모든 열에서 서로 다른 값을 모아 둔 표다.
// 찾는 말을 칠 때마다 테이블을 하나하나 뒤지지 않고 이 표에서 바로 고른다.
// 순서: 값 전체가 같은 것 → 앞부분이 같은 것 → 가운데에 들어 있는 것. 같은 순위면 짧은 값이 먼저.
// 고르면 그 테이블을 그 열 = 값으로 거른 화면이 열린다.
// 색인은 DuckDB의 main.__dv_value_index에 두고, 데이터가 바뀌면(version) 다시 만든다.

const INDEX = "main.__dv_value_index";
export const SUGGEST_LIMIT = 50;
const MAX_VALUE_LENGTH = 200; // 긴 글(설명 문장)은 색인에 넣지 않는다

export interface Suggestion {
  value: string;
  sourceId: string;
  table: string;
  column: string;
  rows: number; // 그 값이 나오는 행 수
  rank: 0 | 1 | 2; // 0 같음, 1 앞부분, 2 포함
}

let built: { version: string; promise: Promise<{ values: number; ms: number }> } | null = null;

export function ensureValueIndex(version: string, tables: { sourceId: string; table: string }[], columns: Map<string, QueryColumn[]>) {
  if (built?.version !== version) built = { version, promise: build(tables, columns) };
  return built.promise;
}

async function build(tables: { sourceId: string; table: string }[], columns: Map<string, QueryColumn[]>) {
  const started = performance.now();
  await execute(`DROP TABLE IF EXISTS ${INDEX}`);
  await execute(`CREATE TABLE ${INDEX} (v VARCHAR, lv VARCHAR, src VARCHAR, tbl VARCHAR, col VARCHAR, n BIGINT)`);
  // 테이블마다 한 번씩 넣는다. 열마다 UNION ALL로 묶는다.
  for (const t of tables) {
    const cols = columns.get(tableKey(t.sourceId, t.table)) ?? [];
    if (!cols.length) continue;
    const from = qualifiedTable(t.sourceId, t.table);
    // 숫자 열의 800.0은 800으로 맞춘다(화면에 보이는 값과 같게).
    const parts = cols.map((c) => {
      const raw = `trim(CAST(${quoteIdent(c.name)} AS VARCHAR))`;
      const v = c.type === "number" ? `regexp_replace(${raw}, '^(-?\\d+)\\.0+$', '\\1')` : raw;
      return `SELECT ${v} AS v, ${quoteString(c.name)} AS col FROM ${from} WHERE ${quoteIdent(c.name)} IS NOT NULL`;
    });
    await execute(
      `INSERT INTO ${INDEX}
       SELECT v, lower(v), ${quoteString(t.sourceId)}, ${quoteString(t.table)}, col, CAST(count(*) AS BIGINT)
       FROM (${parts.join(" UNION ALL ")})
       WHERE v <> '' AND length(v) <= ${MAX_VALUE_LENGTH}
       GROUP BY v, col`,
    );
  }
  const r = await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${INDEX}`, 1);
  return { values: Number(r.rows[0]?.[0] ?? 0), ms: Math.round(performance.now() - started) };
}

export async function suggestValues(query: string, limit = SUGGEST_LIMIT): Promise<{ items: Suggestion[]; total: number }> {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [], total: 0 };
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const where = `lv LIKE ${quoteString(`%${escaped}%`)} ESCAPE '\\'`;
  const rank = `CASE WHEN lv = ${quoteString(q)} THEN 0 WHEN starts_with(lv, ${quoteString(q)}) THEN 1 ELSE 2 END`;
  const r = await runQuery(
    `SELECT v, src, tbl, col, n, ${rank} AS rank FROM ${INDEX} WHERE ${where}
     ORDER BY rank, length(v), v, tbl, col LIMIT ${limit}`,
    limit,
  );
  const c = await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${INDEX} WHERE ${where}`, 1);
  return {
    items: r.rows.map(([v, src, tbl, col, n, rk]) => ({
      value: String(v),
      sourceId: String(src),
      table: String(tbl),
      column: String(col),
      rows: Number(n),
      rank: Number(rk) as Suggestion["rank"],
    })),
    total: Number(c.rows[0]?.[0] ?? 0),
  };
}
