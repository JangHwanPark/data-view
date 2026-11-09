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

// ID 열처럼 값이 거의 다 다르고 빈 칸이 거의 없는지. 실제 데이터에는 실수로 들어간 중복 ID가 섞여 있곤 해서
// 100%를 요구하지 않는다. 98% 기준이고, 행이 적은 테이블(25행에 중복 1개)도 중복이 두 개까지면 ID로 본다.
export function mostlyUnique(rows: number, distinct: number, filled: number) {
  if (rows <= 0 || filled < rows * 0.98) return false;
  return distinct >= rows * 0.98 || (rows - distinct <= 2 && distinct >= rows * 0.9);
}
