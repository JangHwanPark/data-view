import { execute, getDuckDB } from "@/lib/client/duckdb";
import { qualifiedTable, schemaName } from "@/lib/client/file-import";
import type { DbSourceMeta } from "@/lib/client/opfs";
import { quoteIdent, quoteString } from "@/lib/query-result";

interface DbColumn {
  name: string;
  dataType: string;
}

interface DbTable {
  name: string;
  estimatedRows: number;
  columns: DbColumn[];
}

export class DbRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// 서버 오류 코드를 화면 문구로 바꾼다. 원문은 상세 보기에만 쓴다.
export function dbErrorText(code: string) {
  switch (code) {
    case "AUTH_FAILED":
      return "아이디나 비밀번호가 맞지 않습니다.";
    case "CONNECT_FAILED":
      return "서버에 연결할 수 없습니다. 주소와 포트, 서버가 켜져 있는지 확인해 주세요.";
    case "DATABASE_NOT_FOUND":
      return "데이터베이스를 찾을 수 없습니다.";
    case "NOT_FOUND":
      return "저장된 연결 정보를 찾을 수 없습니다. 다시 연결해 주세요.";
    case "BAD_REQUEST":
      return "입력한 접속 정보를 확인해 주세요.";
    default:
      return "데이터베이스에서 데이터를 읽지 못했습니다.";
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DbRequestError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const DATE_TYPES = new Set(["date", "datetime", "timestamp"]);

export interface DbLoadResult {
  tables: string[];
  truncated: string[]; // 행 수 제한에 걸린 테이블
}

// DB의 모든 테이블을 DuckDB에 스냅샷으로 넣는다. 파일과 같이 소스마다 스키마 하나를 쓴다.
export async function loadDbIntoDuckDB(meta: DbSourceMeta): Promise<DbLoadResult> {
  const { tables } = await requestJson<{ tables: DbTable[] }>(`/api/connections/${meta.connectionId}/tables`);
  const schema = quoteIdent(schemaName(meta.id));
  await execute(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await execute(`CREATE SCHEMA ${schema}`);

  const db = await getDuckDB();
  const truncated: string[] = [];
  for (const table of tables) {
    const data = await requestJson<{ columns: DbColumn[]; rows: unknown[][]; truncated: boolean }>(
      `/api/connections/${meta.connectionId}/tables/${encodeURIComponent(table.name)}`,
    );
    if (data.truncated) truncated.push(table.name);
    const target = qualifiedTable(meta.id, table.name);

    if (data.rows.length === 0) {
      // 빈 테이블은 열만 만든다. JSON 추론은 빈 배열에서 열을 알 수 없다.
      await execute(`CREATE TABLE ${target} (${data.columns.map((c) => `${quoteIdent(c.name)} VARCHAR`).join(", ")})`);
      continue;
    }

    const records = data.rows.map((row) => Object.fromEntries(data.columns.map((c, i) => [c.name, row[i] ?? null])));
    const path = `${meta.id}/${table.name}.json`;
    await db.registerFileText(path, JSON.stringify(records));
    try {
      await execute(`CREATE TABLE ${target} AS SELECT * FROM read_json_auto(${quoteString(path)}, format = 'array')`);
    } finally {
      await db.dropFile(path);
    }
    // JSON으로 넘어오며 문자열이 된 날짜 열은 원래 타입으로 되돌린다.
    for (const c of data.columns.filter((c) => DATE_TYPES.has(c.dataType.toLowerCase()))) {
      const col = quoteIdent(c.name);
      await execute(`ALTER TABLE ${target} ALTER COLUMN ${col} TYPE TIMESTAMP USING TRY_CAST(${col} AS TIMESTAMP)`);
    }
  }
  return { tables: tables.map((t) => t.name), truncated };
}
