import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import type { TableRef } from "@/lib/client/relations";
import { tableKey } from "@/lib/client/schema";
import { quoteIdent, quoteString, type QueryColumn, type QueryResult } from "@/lib/query-result";

export type SearchMode = "exact" | "contains";

export interface SearchHit extends TableRef {
  result: QueryResult;
  matched: string[][]; // 행마다 값이 맞은 열 이름
}

export const SEARCH_ROW_LIMIT = 100;
const MATCHED = "__dv_matched";
const SEPARATOR = "\u001f";

// 모든 테이블의 모든 열에서 값을 찾는다. 테이블마다 쿼리 하나씩 돌린다.
export async function searchValue(
  tables: TableRef[],
  columns: Map<string, QueryColumn[]>,
  query: string,
  mode: SearchMode,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (const table of tables) {
    const cols = columns.get(tableKey(table.sourceId, table.table)) ?? [];
    if (cols.length === 0) continue;

    const conditions = cols.map((c) => condition(c, query, mode));
    const matchedExpr = `concat_ws(${quoteString(SEPARATOR)}, ${cols
      .map((c, i) => `CASE WHEN ${conditions[i]} THEN ${quoteString(c.name)} END`)
      .join(", ")})`;
    const result = await runQuery(
      `SELECT *, ${matchedExpr} AS ${MATCHED}
       FROM ${qualifiedTable(table.sourceId, table.table)}
       WHERE ${conditions.map((c) => `(${c})`).join(" OR ")}`,
      SEARCH_ROW_LIMIT,
    );
    if (result.rowCount === 0) continue;

    // 맞은 열 목록은 화면 표시용이라 결과 열에서 뺀다.
    const last = result.columns.length - 1;
    hits.push({
      ...table,
      matched: result.rows.map((row) => String(row[last] ?? "").split(SEPARATOR).filter(Boolean)),
      result: {
        ...result,
        columns: result.columns.slice(0, last),
        rows: result.rows.map((row) => row.slice(0, last)),
      },
    });
  }
  return hits;
}

function condition(column: QueryColumn, query: string, mode: SearchMode) {
  const col = quoteIdent(column.name);
  const text = `CAST(${col} AS VARCHAR)`;
  if (mode === "contains") {
    const escaped = query.replace(/[\\%_]/g, (m) => `\\${m}`);
    return `${text} ILIKE ${quoteString(`%${escaped}%`)} ESCAPE '\\'`;
  }
  // 숫자 열은 800과 800.0을 같은 값으로 보도록 숫자로도 비교한다.
  const asNumber = Number(query);
  if (column.type === "number" && query.trim() !== "" && Number.isFinite(asNumber)) {
    return `${text} = ${quoteString(query)} OR ${col} = ${asNumber}`;
  }
  return `${text} = ${quoteString(query)}`;
}
