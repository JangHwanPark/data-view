import * as duckdb from "@duckdb/duckdb-wasm";
import { DataType, type Table } from "apache-arrow";
import type { ColumnType, QueryResult } from "@/lib/query-result";

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: "/duckdb/duckdb-mvp.wasm",
    mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
  },
  eh: {
    mainModule: "/duckdb/duckdb-eh.wasm",
    mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
  },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

// 앱 전체에서 DuckDB 인스턴스 하나만 쓴다.
export function getDuckDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
    // 초기화에 실패하면 다음 호출에서 다시 시도할 수 있게 비운다.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function execute(sql: string) {
  const db = await getDuckDB();
  const conn = await db.connect();
  try {
    await conn.query(sql);
  } finally {
    await conn.close();
  }
}

// limit을 넘는 행이 있으면 잘라내고 truncated로 알린다.
export async function runQuery(sql: string, limit: number): Promise<QueryResult> {
  const db = await getDuckDB();
  const conn = await db.connect();
  const started = performance.now();
  try {
    const table = await conn.query(`SELECT * FROM (${sql}) LIMIT ${limit + 1}`);
    const result = toQueryResult(table, limit);
    result.elapsedMs = Math.round(performance.now() - started);
    return result;
  } finally {
    await conn.close();
  }
}

function toQueryResult(table: Table, limit: number): QueryResult {
  const fields = table.schema.fields;
  const columns = fields.map((f) => ({ name: f.name, type: toColumnType(f.type) }));
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const total = table.numRows;
  const count = Math.min(total, limit);

  const rows: unknown[][] = [];
  for (let r = 0; r < count; r++) {
    rows.push(columns.map((c, i) => normalize(vectors[i]?.get(r), c.type)));
  }
  return { columns, rows, rowCount: count, truncated: total > limit, elapsedMs: 0 };
}

function toColumnType(type: DataType): ColumnType {
  if (DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)) return "number";
  if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) return "string";
  if (DataType.isBool(type)) return "boolean";
  if (DataType.isDate(type) || DataType.isTimestamp(type)) return "date";
  return "unknown";
}

function normalize(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (type === "date") {
    const ms = value instanceof Date ? value.getTime() : Number(value);
    return new Date(ms).toISOString();
  }
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  }
  return value;
}
