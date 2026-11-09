// duckdb-wasm은 서버에서 평가되면 Node용 빌드가 worker_threads의 workerData를 읽다가 터진다.
// (개발 서버의 instant 검증이 레이아웃을 서버에서 렌더하며 이 모듈을 평가한다.)
// 그래서 타입만 정적으로 가져오고, 실제 모듈은 브라우저에서 처음 쓸 때 동적으로 불러온다.
import type * as duckdb from "@duckdb/duckdb-wasm";
import { DataType, type Table } from "apache-arrow";
import type { ColumnType, QueryResult } from "@/shared/lib/query-result";

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

export function loadDuckDBModule() {
  return import("@duckdb/duckdb-wasm");
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

// 앱 전체에서 DuckDB 인스턴스 하나만 쓴다.
export function getDuckDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const duckdb = await loadDuckDBModule();
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
