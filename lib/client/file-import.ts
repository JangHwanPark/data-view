import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";
import * as XLSX from "xlsx";
import { execute, getDuckDB } from "@/lib/client/duckdb";
import type { FileKind, FileSourceMeta } from "@/lib/client/opfs";
import { quoteIdent, quoteString } from "@/lib/query-result";

export function detectKind(fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return null;
}

// 소스마다 DuckDB 스키마 하나를 쓴다. 파일 이름이 같아도 테이블이 겹치지 않는다.
export function schemaName(sourceId: string) {
  return `s_${sourceId}`;
}

export function qualifiedTable(sourceId: string, table: string) {
  return `${quoteIdent(schemaName(sourceId))}.${quoteIdent(table)}`;
}

// 패치 전후 비교용 이전 파일은 p_<id> 스키마에 따로 올린다. 소스 목록에는 넣지 않는다.
export function previousSchemaName(sourceId: string) {
  return `p_${sourceId}`;
}

export function previousTable(sourceId: string, table: string) {
  return `${quoteIdent(previousSchemaName(sourceId))}.${quoteIdent(table)}`;
}

// 파일을 DuckDB 테이블로 적재하고 만든 테이블 이름 목록을 돌려준다.
// schema를 주면 그 스키마에 올린다(이전 파일 비교용). 테이블 이름 규칙은 같다.
export async function loadIntoDuckDB(meta: FileSourceMeta, file: File, schema = schemaName(meta.id)): Promise<string[]> {
  const quoted = quoteIdent(schema);
  await execute(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  await execute(`CREATE SCHEMA ${quoted}`);
  const target = (table: string) => `${quoted}.${quoteIdent(table)}`;
  return meta.kind === "csv" ? loadCsv(meta, file, schema, target) : loadExcel(meta, file, schema, target);
}

export async function dropSource(sourceId: string) {
  await execute(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName(sourceId))} CASCADE`);
}

type Target = (table: string) => string;

async function loadCsv(meta: FileSourceMeta, file: File, schema: string, target: Target) {
  const db = await getDuckDB();
  const path = `${schema}/${meta.fileName}`;
  await db.registerFileHandle(path, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
  try {
    // 테이블 이름은 실제 파일명이 아니라 소스 이름에서 만든다. 갱신본으로 교체해도 관계가 유지된다.
    const table = tableName(meta.name);
    await execute(
      `CREATE TABLE ${target(table)} AS
       SELECT * FROM read_csv_auto(${quoteString(path)}, header = ${meta.header})`,
    );
    return [table];
  } finally {
    await db.dropFile(path);
  }
}

async function loadExcel(meta: FileSourceMeta, file: File, schema: string, targetOf: Target) {
  const db = await getDuckDB();
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: true });
  const tables: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    // 빈 시트는 테이블을 만들지 않는다.
    if (aoa.length === 0) continue;

    const { records, dateColumns } = toRecords(aoa, meta.header);
    if (records.length === 0) continue;

    // 갱신본으로 교체해도 관계가 유지되도록 파일명은 빼고 시트 이름만 쓴다.
    const table = uniqueName(tableName(sheetName), tables);
    const target = targetOf(table);
    const path = `${schema}/${tables.length}.json`;
    await db.registerFileText(path, JSON.stringify(records));
    try {
      await execute(
        `CREATE TABLE ${target} AS SELECT * FROM read_json_auto(${quoteString(path)}, format = 'array')`,
      );
    } finally {
      await db.dropFile(path);
    }
    // JSON에서는 날짜가 문자열로 추론되므로 값이 전부 날짜인 열은 직접 바꾼다.
    for (const column of dateColumns) {
      const col = quoteIdent(column);
      await execute(`ALTER TABLE ${target} ALTER COLUMN ${col} TYPE TIMESTAMP USING CAST(${col} AS TIMESTAMP)`);
    }
    tables.push(table);
  }
  return tables;
}

function toRecords(aoa: unknown[][], header: boolean) {
  // 행이 많으면 Math.max(...rows)가 호출 스택을 넘길 수 있어서 reduce로 구한다.
  const width = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = header ? aoa[0] : [];
  const names: string[] = [];
  for (let i = 0; i < width; i++) {
    const raw = headerRow[i];
    const name = raw === null || raw === undefined || String(raw).trim() === "" ? `column_${i + 1}` : String(raw).trim();
    names.push(uniqueName(name, names));
  }

  const body = header ? aoa.slice(1) : aoa;
  // 값이 하나라도 있고 그 값이 전부 Date인 열만 날짜 열로 본다.
  const isDate = names.map(() => true);
  const hasValue = names.map(() => false);

  const records = body.map((row) => {
    const record: Record<string, unknown> = {};
    names.forEach((name, i) => {
      const value = row[i] ?? null;
      if (value !== null) {
        hasValue[i] = true;
        if (!(value instanceof Date)) isDate[i] = false;
      }
      // SheetJS의 Date는 UTC 기준이라 UTC 값을 그대로 TIMESTAMP 문자열로 쓴다.
      record[name] = value instanceof Date ? value.toISOString().slice(0, 23).replace("T", " ") : value;
    });
    return record;
  });

  const dateColumns = names.filter((_, i) => hasValue[i] && isDate[i]);
  return { records, dateColumns };
}

function tableName(name: string) {
  const withoutExt = name.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "table";
}

// DuckDB는 식별자의 대소문자를 구분하지 않아서 비교도 소문자로 한다.
function uniqueName(name: string, taken: string[]) {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  let n = 2;
  while (lower.has(`${name}_${n}`.toLowerCase())) n++;
  return `${name}_${n}`;
}
