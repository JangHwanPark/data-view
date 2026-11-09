import type { Catalog } from "@/core/doc-infer";
import type { ParsedDoc } from "@/core/doc-import";
import { runQuery } from "@/core/duckdb";
import { qualifiedTable, tableRules } from "@/core/file-import";
import { quoteIdent, quoteString } from "@/shared/lib/query-result";

// 기획서와 데이터의 불일치 검출(설계 4.11). 기획서의 표 가운데 머리글에 어떤 테이블의 ID 열이 있는 표를 골라,
// 그 ID로 실제 행을 찾고 칸마다 값을 비교한다. 예: 기획서 표의 quest_id 71005 행 reward_group_id가 51205인데
// 데이터는 51207이면 "데이터와 다른 값", 기획서에 있는 79999가 데이터에 없으면 "데이터에 없는 ID"다.

export interface DocCheckIssue {
  kind: "value" | "missing-row" | "sentence"; // sentence: 「이름: 값」 문장의 수치가 데이터와 다름(29단계)
  sectionId: string;
  sectionTitle: string;
  tableIndex: number; // 절 안의 몇 번째 표인지
  rowIndex: number; // 표 안의 몇 번째 행인지(머리글 제외)
  columnIndex: number; // 다른 칸의 위치. 없는 ID면 ID 칸 위치
  sourceId: string;
  table: string;
  keyColumn: string;
  key: string;
  column: string | null; // 다른 값이면 그 열
  docValue: string;
  dataValue: string | null;
  line?: string; // sentence일 때 그 문장
}

export interface SentenceCheck {
  sectionId: string;
  line: string;
  table: string;
  keyColumn: string;
  key: string;
  column: string;
  docValue: string;
  dataValue: string | null;
  same: boolean;
}

export interface DocCheckTable {
  sectionId: string;
  tableIndex: number;
  sourceId: string;
  table: string;
  keyColumn: string;
  columns: string[]; // 비교한 열(ID 열 제외)
  rows: number;
}

export interface DocCheckResult {
  issues: DocCheckIssue[];
  compared: DocCheckTable[]; // 비교한 표
  skipped: number; // 데이터 테이블과 이어지지 않아 비교하지 못한 표 수
  sentences: SentenceCheck[]; // 비교한 「이름: 값」 문장(같은 것 포함)
}

// 숫자는 쉼표와 공백을 떼고, %는 100으로 나눈 값도 같은 값으로 본다(10%와 0.1).
function numbers(raw: string): number[] {
  const text = raw.replace(/[,\s]/g, "");
  if (/^-?\d+(\.\d+)?%$/.test(text)) {
    const n = Number(text.slice(0, -1));
    return [n, n / 100];
  }
  return /^-?\d+(\.\d+)?$/.test(text) ? [Number(text)] : [];
}

export function sameValue(docValue: string, dataValue: unknown) {
  if (dataValue === null || dataValue === undefined) return docValue.trim() === "";
  const data = String(dataValue).trim();
  const doc = docValue.trim();
  if (doc === data) return true;
  const a = numbers(doc);
  const b = numbers(data);
  if (a.length && b.length) return a.some((x) => b.some((y) => Math.abs(x - y) < 1e-9));
  return doc.toLowerCase() === data.toLowerCase();
}

// 같은 ID라도 숫자 열은 800.0처럼 읽힐 수 있어 숫자는 숫자로 맞춘다.
const normKey = (v: unknown) => {
  const s = String(v).trim().replace(/,/g, "");
  return /^-?\d+(\.0+)?$/.test(s) ? String(Number(s)) : s;
};

// 기획서 표가 어느 테이블의 표인지 고른다. 머리글에 그 테이블의 ID 열이 있어야 하고,
// 머리글과 이름이 같은 열이 가장 많은 테이블을 고른다. 같으면 ID 열이 앞쪽 머리글인 테이블을 쓴다.
function pickTable(header: string[], catalog: Catalog) {
  let best: { t: Catalog["tables"][number]; keyIndex: number; columns: number[] } | null = null;
  for (const t of catalog.tables) {
    if (!t.keyColumn) continue;
    const keyIndex = header.indexOf(t.keyColumn);
    if (keyIndex < 0) continue;
    const columns = header.map((h, i) => (i !== keyIndex && t.columns.includes(h) ? i : -1)).filter((i) => i >= 0);
    if (!columns.length) continue;
    if (!best || columns.length > best.columns.length || (columns.length === best.columns.length && keyIndex < best.keyIndex)) {
      best = { t, keyIndex, columns };
    }
  }
  return best;
}

export async function checkDoc(doc: ParsedDoc, catalog: Catalog): Promise<DocCheckResult> {
  const issues: DocCheckIssue[] = [];
  const compared: DocCheckTable[] = [];
  let skipped = 0;
  for (const section of doc.sections) {
    for (const [tableIndex, docTable] of section.tables.entries()) {
      const header = docTable.header.map((h) => h.trim());
      const picked = pickTable(header, catalog);
      if (!picked) {
        if (docTable.rows.length) skipped++;
        continue;
      }
      const { t, keyIndex, columns } = picked;
      const keys = [...new Set(docTable.rows.map((r) => (r[keyIndex] ?? "").trim()).filter(Boolean))];
      if (!keys.length) continue;
      const wanted = [t.keyColumn!, ...columns.map((i) => header[i])];
      const key = quoteIdent(t.keyColumn!);
      const numeric = keys.filter((k) => /^-?\d+(\.\d+)?$/.test(k.replace(/,/g, ""))).map((k) => Number(k.replace(/,/g, "")));
      const where = [`CAST(${key} AS VARCHAR) IN (${keys.map(quoteString).join(",")})`, ...(numeric.length ? [`TRY_CAST(${key} AS DOUBLE) IN (${numeric.join(",")})`] : [])].join(" OR ");
      const result = await runQuery(`SELECT ${wanted.map(quoteIdent).join(", ")} FROM ${qualifiedTable(t.sourceId, t.table)} WHERE ${where}`, keys.length * 4 + 10);
      // 중복 ID가 있으면 첫 행을 쓴다. 중복 자체는 "없는 ID 찾기"의 중복 ID에서 본다.
      const byKey = new Map<string, unknown[]>();
      for (const row of result.rows) if (!byKey.has(normKey(row[0]))) byKey.set(normKey(row[0]), row);
      compared.push({ sectionId: section.id, tableIndex, sourceId: t.sourceId, table: t.table, keyColumn: t.keyColumn!, columns: columns.map((i) => header[i]), rows: docTable.rows.length });

      for (const [rowIndex, row] of docTable.rows.entries()) {
        const id = (row[keyIndex] ?? "").trim();
        if (!id) continue;
        const base = { sectionId: section.id, sectionTitle: section.title, tableIndex, rowIndex, sourceId: t.sourceId, table: t.table, keyColumn: t.keyColumn!, key: id };
        const data = byKey.get(normKey(id));
        if (!data) {
          issues.push({ ...base, kind: "missing-row", columnIndex: keyIndex, column: null, docValue: id, dataValue: null });
          continue;
        }
        columns.forEach((ci, j) => {
          const docValue = row[ci] ?? "";
          if (!docValue.trim() || sameValue(docValue, data[j + 1])) return;
          issues.push({ ...base, kind: "value", columnIndex: ci, column: header[ci], docValue, dataValue: data[j + 1] === null ? null : String(data[j + 1]) });
        });
      }
    }
  }
  const sentences = await checkSentences(doc, catalog);
  for (const s of sentences) {
    if (s.same) continue;
    const section = doc.sections.find((x) => x.id === s.sectionId);
    const t = catalog.tables.find((x) => x.table === s.table)!;
    issues.push({
      kind: "sentence",
      sectionId: s.sectionId,
      sectionTitle: section?.title ?? "",
      tableIndex: -1,
      rowIndex: -1,
      columnIndex: -1,
      sourceId: t.sourceId,
      table: s.table,
      keyColumn: s.keyColumn,
      key: s.key,
      column: s.column,
      docValue: s.docValue,
      dataValue: s.dataValue,
      line: s.line,
    });
  }
  return { issues, compared, skipped, sentences };
}

// 문장 속 수치 비교(PLAN.md 29단계, 5-4). 「배(FruitId 1002) 판매 가격: 3290골드」처럼 「이름: 수치」를 쓴 문장에서
// 1) 이름이 어느 테이블의 어느 컬럼인지 고른다: 이름 안의 영문 단어가 컬럼 이름과 같거나, 엑셀 #Design 설명이 그 한글 이름으로 시작하는 컬럼
// 2) 같은 문장에 나온 ID(세 자리 이상 숫자)로 그 테이블의 행을 찾는다: ID 컬럼이나 이름이 Id로 끝나는 컬럼. 이름 안에 「FruitId 1002」처럼 컬럼을 적었으면 그 컬럼
// 3) 그 행의 값과 수치를 비교한다(쉼표, 단위, %는 표 비교와 같은 기준)
const SENTENCE = /([^:：.!?]{1,40})[:：]\s*(-?[\d,]+(?:\.\d+)?%?)\s*([가-힣A-Za-z]{0,3})/g;

export async function checkSentences(doc: ParsedDoc, catalog: Catalog): Promise<SentenceCheck[]> {
  const out: SentenceCheck[] = [];
  for (const section of doc.sections) {
    for (const line of section.lines) {
      for (const m of line.matchAll(SENTENCE)) {
        const label = m[1].trim();
        const docValue = m[2];
        const ids = [...label.matchAll(/(?<![\d.])(\d{3,})(?![\d.])/g)].map((x) => x[1]);
        if (!ids.length) continue;
        const words = [...label.matchAll(/[A-Za-z_][\w#]*/g)].map((x) => x[0].toLowerCase());
        const korean = label.replace(/\([^)]*\)/g, " ").replace(/[\dA-Za-z_#]+/g, " ").replace(/\s+/g, " ").trim();
        const hit = await findSentenceRow(catalog, words, korean, ids);
        if (!hit) continue;
        out.push({ sectionId: section.id, line: line.trim(), ...hit, docValue, same: sameValue(docValue, hit.dataValue) });
      }
    }
  }
  return out;
}

const descHead = (text: string) => text.split(/[(.,]/)[0].trim();

async function findSentenceRow(catalog: Catalog, words: string[], korean: string, ids: string[]) {
  for (const t of catalog.tables) {
    const descs = tableRules(t.sourceId, t.table)?.descriptions ?? [];
    const lookups = t.columns.filter((c) => c === t.keyColumn || /id$/i.test(c));
    // 이름 안에 적은 조회 컬럼(FruitId 1002)은 값 컬럼 후보에서 뺀다.
    const named = lookups.filter((c) => words.includes(c.toLowerCase()));
    const valueColumn =
      t.columns.find((c) => words.includes(c.toLowerCase()) && !named.includes(c) && !lookups.includes(c)) ??
      // #Design 설명의 앞머리(「판매 가격(골드)」의 「판매 가격」)로 한글 이름이 끝나면 그 컬럼(「사과 판매 가격」).
      (korean.length >= 2 ? descs.find((d) => d.columns.length === 1 && descHead(d.text).length >= 2 && korean.endsWith(descHead(d.text)))?.columns[0] : undefined) ??
      (korean.length >= 2 ? t.columns.find((c) => c.toLowerCase() === korean.toLowerCase()) : undefined);
    if (!valueColumn) continue;
    for (const column of named.length ? named : lookups) {
      for (const id of ids) {
        const c = quoteIdent(column);
        const r = await runQuery(
          `SELECT CAST(${quoteIdent(valueColumn)} AS VARCHAR) FROM ${qualifiedTable(t.sourceId, t.table)} WHERE CAST(${c} AS VARCHAR) = ${quoteString(id)} OR TRY_CAST(${c} AS DOUBLE) = ${Number(id)} LIMIT 1`,
          1,
        );
        if (r.rows.length) {
          const v = r.rows[0][0];
          return { table: t.table, keyColumn: column, key: id, column: valueColumn, dataValue: v === null || v === undefined ? null : String(v).replace(/^(-?\d+)\.0+$/, "$1") };
        }
      }
    }
  }
  return null;
}
