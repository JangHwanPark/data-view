export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export interface QueryColumn {
  name: string;
  type: ColumnType;
}

// 모든 데이터 소스의 조회 결과를 이 형태로 맞춘다. 표와 차트는 이 타입만 안다.
export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export function quoteIdent(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
