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
  rulesBySource.delete(sourceId);
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

// 엑셀 읽기 규칙(PLAN.md 23단계)으로 알아낸 것. 데이터 표에 열을 더하면 SELECT *를 쓰는 모든 화면에 섞이므로
// 소스를 읽을 때 따로 모아 둔다. 페이지를 열 때마다 소스를 다시 읽으므로 저장하지 않는다.
export interface ColumnRule {
  name: string; // 테이블의 컬럼 이름(두 줄 머리글이면 아랫줄)
  raw: string; // 머리글 원문
  group: string | null; // 두 줄 머리글의 윗줄(묶음 이름)
  memo: boolean; // #로 시작하는 메모 열. DB에는 없다
}
export interface TableRules {
  headerRow: number; // 머리글이 있던 줄(1부터)
  columns: ColumnRule[];
  inactive: string[]; // ;로 막아 둔 행의 Id(;는 뗀 값)
}
const rulesBySource = new Map<string, Map<string, TableRules>>();

export function tableRules(sourceId: string, table: string): TableRules | undefined {
  return rulesBySource.get(sourceId)?.get(table);
}

// 비활성 행 Id 모음. 데이터 표에서 줄을 긋고, 행 수에서 뺄 때 쓴다.
export function inactiveIds(sourceId: string, table: string): Set<string> {
  return new Set(tableRules(sourceId, table)?.inactive ?? []);
}

export function isMemoColumn(sourceId: string, table: string, column: string) {
  return !!tableRules(sourceId, table)?.columns.some((c) => c.name === column && c.memo);
}

async function loadExcel(meta: FileSourceMeta, file: File, schema: string, targetOf: Target) {
  const db = await getDuckDB();
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: true });
  const tables: string[] = [];
  const rules = new Map<string, TableRules>();

  for (const sheetName of workbook.SheetNames) {
    // #Design, #Definition처럼 #로 시작하는 시트는 데이터가 아니라 설명이다. 내용은 24단계에서 읽는다.
    if (sheetName.trim().startsWith("#")) continue;
    const sheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    // 빈 시트는 테이블을 만들지 않는다.
    if (aoa.length === 0) continue;

    const { records, dateColumns, columns, inactive, headerRow } = toRecords(aoa, meta.header);
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
    rules.set(table, { headerRow: headerRow + 1, columns, inactive });
  }
  // 이전 버전(비교용 p_ 스키마)을 읽을 때는 지금 규칙을 덮어쓰지 않는다.
  if (schema === schemaName(meta.id)) rulesBySource.set(meta.id, rules);
  return tables;
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

// 머리글 줄 찾기. 시트 맨 위에 설명 줄이 몇 줄 있고 그 아래에 머리글이 오기도 한다.
// 위쪽 20줄에서, 값이 있는 칸 수가 가장 많은 줄의 60% 이상이고 모두 글자인 첫 줄을 머리글로 본다.
// 설명 줄은 칸 한두 개만 쓰므로 걸러진다. 그런 줄이 없으면 첫 줄을 쓴다.
export function findHeaderRow(aoa: unknown[][]) {
  const sample = aoa.slice(0, 20);
  const counts = sample.map((row) => row.filter((v) => !isBlank(v)).length);
  const most = Math.max(0, ...counts);
  for (let i = 0; i < sample.length; i++) {
    const cells = sample[i].filter((v) => !isBlank(v));
    if (cells.length >= Math.min(2, most) && cells.length >= Math.ceil(most * 0.6) && cells.every((v) => typeof v === "string")) return i;
  }
  return 0;
}

// 두 줄 머리글("Reward_" 줄바꿈 "Asset#1")은 아랫줄을 컬럼 이름으로, 윗줄을 묶음 이름으로 쓴다.
export function splitHeader(raw: string) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { name: raw.trim(), group: null as string | null };
  return { name: lines[lines.length - 1], group: lines.slice(0, -1).join(" ") };
}

// 첫 열 값이 ;로 시작하면 쓰지 않는(비활성) 행이다. ;를 떼어 원래 Id로 둔다(다른 테이블이 가리키는지 찾을 수 있게).
export function inactiveId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^\s*;\s*(.*)$/);
  return m ? m[1].trim() : null;
}

function toRecords(aoa: unknown[][], header: boolean) {
  // 행이 많으면 Math.max(...rows)가 호출 스택을 넘길 수 있어서 reduce로 구한다.
  const width = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  const headerIndex = header ? findHeaderRow(aoa) : -1;
  const headerCells = header ? aoa[headerIndex] : [];
  const names: string[] = [];
  const columns: ColumnRule[] = [];
  for (let i = 0; i < width; i++) {
    const raw = headerCells[i];
    const text = isBlank(raw) ? "" : String(raw);
    const { name: base, group } = text ? splitHeader(text) : { name: `column_${i + 1}`, group: null };
    const name = uniqueName(base, names);
    names.push(name);
    // #로 시작하는 열(#이름)은 기획자가 적어 둔 메모다. DB에는 없는 열이라 연결을 찾을 때 쓰지 않는다.
    columns.push({ name, raw: text, group, memo: name.startsWith("#") });
  }

  const body = header ? aoa.slice(headerIndex + 1) : aoa;
  const inactive: string[] = [];
  // 값이 하나라도 있고 그 값이 전부 Date인 열만 날짜 열로 본다.
  const isDate = names.map(() => true);
  const hasValue = names.map(() => false);

  const records = body.map((row) => {
    const record: Record<string, unknown> = {};
    names.forEach((name, i) => {
      let value = row[i] ?? null;
      // 지운 칸이 빈 글자로 남은 것은 빈 칸으로 본다. 그래야 숫자 ID 열이 글자 열로 바뀌지 않는다.
      if (typeof value === "string" && value.trim() === "") value = null;
      if (i === 0) {
        const id = inactiveId(value);
        if (id !== null) {
          inactive.push(id);
          // 숫자 Id는 숫자로 돌려놓아 다른 행과 같은 종류의 열이 되게 한다.
          value = /^-?\d+(\.\d+)?$/.test(id) ? Number(id) : id;
        }
      }
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
  return { records, dateColumns, columns, inactive, headerRow: Math.max(0, headerIndex) };
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
