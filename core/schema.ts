import { runQuery } from "@/core/duckdb";
import { tableRules } from "@/core/file-import";
import type { ColumnType, QueryColumn } from "@/shared/lib/query-result";

export function tableKey(sourceId: string, table: string) {
  return `${sourceId}/${table}`;
}

// 파일 소스 스키마(s_<id>)에 있는 모든 테이블의 컬럼을 한 번에 읽는다.
export async function loadColumns(): Promise<Map<string, QueryColumn[]>> {
  const result = await runQuery(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE starts_with(table_schema, 's_')
     ORDER BY table_schema, table_name, ordinal_position`,
    100_000,
  );
  const map = new Map<string, QueryColumn[]>();
  for (const [schema, table, column, dataType] of result.rows as string[][]) {
    const key = tableKey(schema.slice(2), table);
    const list = map.get(key) ?? [];
    list.push({ name: column, type: toColumnType(dataType) });
    map.set(key, list);
  }
  return map;
}

// 파일 소스 테이블마다 행 수를 한 번에 읽는다. 테이블마다 count(*)를 돌리지 않으려고 DuckDB 메타데이터를 쓴다.
// ;로 막아 둔 비활성 행은 게임에서 쓰지 않으므로 행 수에서 뺀다.
export async function loadRowCounts(): Promise<Map<string, number>> {
  const result = await runQuery(
    `SELECT schema_name, table_name, estimated_size
     FROM duckdb_tables()
     WHERE starts_with(schema_name, 's_')`,
    100_000,
  );
  const map = new Map<string, number>();
  for (const [schema, table, size] of result.rows) {
    const sourceId = String(schema).slice(2);
    const inactive = tableRules(sourceId, String(table))?.inactive.length ?? 0;
    map.set(tableKey(sourceId, String(table)), Math.max(0, Number(size) - inactive));
  }
  return map;
}

function toColumnType(dataType: string): ColumnType {
  const t = dataType.toUpperCase();
  if (/INT|DOUBLE|FLOAT|DECIMAL|REAL|NUMERIC/.test(t)) return "number";
  if (t.startsWith("VARCHAR") || t === "TEXT") return "string";
  if (t === "BOOLEAN") return "boolean";
  if (t.startsWith("DATE") || t.startsWith("TIMESTAMP")) return "date";
  return "unknown";
}
