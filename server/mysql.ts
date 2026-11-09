import "server-only";
import mysql from "mysql2/promise";
import type { ConnectionInput } from "@/server/connections";

export const TABLE_ROW_LIMIT = 200_000;

export interface DbColumn {
  name: string;
  dataType: string;
}

export interface DbTable {
  name: string;
  estimatedRows: number;
  columns: DbColumn[];
}

// 요청마다 연결을 새로 열고 닫는다. 로컬 단일 사용자 도구라 풀을 둘 이유가 아직 없다.
export async function withConnection<T>(input: ConnectionInput, fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({
    host: input.host,
    port: input.port,
    user: input.user,
    password: input.password,
    database: input.database,
    connectTimeout: 10_000,
    // DECIMAL을 문자열이 아닌 숫자로 받는다.
    decimalNumbers: true,
    // 날짜를 JS Date로 바꾸면 서버 시간대에 따라 날짜가 밀리므로 DB에 있는 문자열 그대로 받는다.
    dateStrings: true,
    charset: "utf8mb4",
  });
  try {
    // 조회 전용 도구라 세션을 읽기 전용으로 건다. 계정 권한이 첫 번째 방어선이고 이것은 두 번째다.
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    // 쿼리 하나가 30초를 넘으면 끊는다. MariaDB는 변수 이름이 달라서 둘 중 되는 쪽만 적용된다.
    await conn.query("SET SESSION max_execution_time = 30000").catch(() => conn.query("SET SESSION max_statement_time = 30").catch(() => {}));
    return await fn(conn);
  } finally {
    await conn.end().catch(() => {});
  }
}

export async function listTables(conn: mysql.Connection, database: string): Promise<DbTable[]> {
  const [tables] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS estimatedRows
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database],
  );
  const [columns] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  return tables.map((t) => ({
    name: String(t.name),
    estimatedRows: Number(t.estimatedRows ?? 0),
    columns: columns.filter((c) => c.tableName === t.name).map((c) => ({ name: String(c.name), dataType: String(c.dataType) })),
  }));
}

// 표 하나를 행 배열로 읽는다. 테이블 이름은 목록에 있는 것만 받는다.
export async function readTable(conn: mysql.Connection, table: DbTable, limit: number) {
  const [rows] = await conn.query({
    sql: `SELECT * FROM ${conn.escapeId(table.name)} LIMIT ?`,
    values: [limit + 1],
    rowsAsArray: true,
  });
  const list = rows as unknown[][];
  return { rows: list.slice(0, limit), truncated: list.length > limit };
}

// 화면에 보여줄 오류 코드로 바꾼다. 원문은 상세 보기에만 쓴다.
export function errorCode(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "ER_ACCESS_DENIED_ERROR") return "AUTH_FAILED";
  if (code === "ER_BAD_DB_ERROR") return "DATABASE_NOT_FOUND";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EHOSTUNREACH") return "CONNECT_FAILED";
  return "QUERY_FAILED";
}
