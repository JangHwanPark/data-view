import { focusWhere } from "@/lib/client/doc-links";
import type { DomainModel, TableInfo } from "@/lib/client/domain-model";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { quoteIdent, quoteString } from "@/lib/query-result";

// 표의 값에 마우스를 올렸을 때 "이게 어떤 데이터인지"를 추론한다(설계 6.4).
// 표의 값은 원본 그대로 두고, 그 값이 가리키는 행을 찾아 사람이 읽을 이름과 주요 값을 모은다.
// 예: Quest.reward_group_id 51205 → 보상 그룹 51205, 보상 3개(아이템 100041 9개 ...)
//     Item.grade_id 5 → 등급 5, 이름 "전설"
//     Item.name_key ITEM_100041 → 다국어 글: "전설의 검"

export interface ExplainField {
  column: string;
  value: string;
  meaning?: string; // 이 값도 다른 테이블을 쓰면 그 행의 이름
}

export interface Explanation {
  key: string; // 대상 테이블 키
  table: string;
  column: string; // 대상 테이블에서 찾은 열
  value: string;
  found: boolean;
  matches: number; // 찾은 행 수(세부 테이블은 여러 행)
  title: string | null; // 사람이 읽는 이름
  titleFrom: string | null; // 이름을 가져온 열(name_key 등)
  isText: boolean; // 대상이 다국어 글 테이블
  fields: ExplainField[];
  children: { table: string; key: string; count: number; samples: string[] }[]; // 이 행의 세부 행
  usedBy: { table: string; column: string; count: number }[]; // 이 ID를 쓰는 곳
}

const MAX_FIELDS = 6;
const MAX_USED_BY = 8;
const TEXT_COLUMNS = ["ko", "kr", "kor", "text", "en", "name"];

let columnsCache: { model: DomainModel; map: Map<string, string[]> } | null = null;
async function columnsOf(model: DomainModel, key: string) {
  if (columnsCache?.model !== model) columnsCache = { model, map: new Map() };
  const hit = columnsCache.map.get(key);
  if (hit) return hit;
  const slash = key.indexOf("/");
  const r = await runQuery(`SELECT * FROM ${qualifiedTable(key.slice(0, slash), key.slice(slash + 1))} LIMIT 0`, 1);
  const names = r.columns.map((c) => c.name);
  columnsCache.map.set(key, names);
  return names;
}

const split = (key: string) => ({ sourceId: key.slice(0, key.indexOf("/")), table: key.slice(key.indexOf("/") + 1) });

// key 열과 ko/en 같은 글 열이 있으면 다국어 글 테이블로 본다(기획서 추론과 같은 기준).
function textColumn(columns: string[]) {
  if (!columns.includes("key")) return null;
  return TEXT_COLUMNS.find((c) => columns.some((x) => x.toLowerCase() === c)) ?? null;
}

// 마우스를 올린 칸이 무엇을 가리키는지. 그 테이블의 첫 열(ID 열)이면 자기 행, 다른 테이블을 쓰는 열이면 그 테이블의 행이다.
export function explainTarget(model: DomainModel, here: string, column: string, firstColumn: string | null) {
  const info = model.tables.get(here);
  if (!info) return null;
  const link = info.out.find((l) => l.column === column);
  if (link) return { key: link.key, column: link.otherColumn };
  if (column === firstColumn) return { key: here, column };
  return null;
}

const cache = new Map<string, Promise<Explanation>>();

export function explainValue(model: DomainModel, target: { key: string; column: string }, value: string): Promise<Explanation> {
  const id = `${target.key}|${target.column}|${value}`;
  if (!cache.has(id)) {
    cache.set(id, compute(model, target, value, 0));
    // 데이터가 바뀌면 모델이 새로 만들어지므로, 너무 쌓이지 않게 오래된 것부터 버린다.
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return cache.get(id)!;
}

async function compute(model: DomainModel, target: { key: string; column: string }, value: string, depth: number): Promise<Explanation> {
  const { sourceId, table } = split(target.key);
  const columns = await columnsOf(model, target.key);
  const info = model.tables.get(target.key) as TableInfo | undefined;
  const where = focusWhere({ column: target.column, value });
  const from = qualifiedTable(sourceId, table);
  const result = await runQuery(`SELECT * FROM ${from} WHERE ${where} LIMIT 1`, 1);
  const count = Number((await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${from} WHERE ${where}`, 1)).rows[0]?.[0] ?? 0);
  const base: Explanation = { key: target.key, table, column: target.column, value, found: false, matches: count, title: null, titleFrom: null, isText: false, fields: [], children: [], usedBy: [] };
  const row = result.rows[0];
  if (!row) return base;
  const cell = (name: string) => {
    const v = row[columns.indexOf(name)];
    return v === null || v === undefined ? null : String(v);
  };

  // 다국어 글 테이블이면 그 글이 곧 이름이다.
  const text = textColumn(columns);
  if (text) {
    const others = columns.filter((c) => c !== "key" && c !== text);
    return { ...base, found: true, isText: true, title: cell(text), titleFrom: text, fields: others.map((c) => ({ column: c, value: cell(c) ?? "(비어 있음)" })).slice(0, MAX_FIELDS) };
  }

  // 이름: 이 행에서 다국어 글 테이블을 쓰는 열(name_key)을 찾아 그 글을 가져온다. 없으면 name, 이름 같은 열을 쓴다.
  let title: string | null = null;
  let titleFrom: string | null = null;
  for (const l of info?.out ?? []) {
    const v = cell(l.column);
    if (v === null) continue;
    const targetColumns = await columnsOf(model, l.key);
    const tc = textColumn(targetColumns);
    if (!tc) continue;
    const t = split(l.key);
    const r = await runQuery(`SELECT ${quoteIdent(tc)} FROM ${qualifiedTable(t.sourceId, t.table)} WHERE CAST(${quoteIdent(l.otherColumn)} AS VARCHAR) = ${quoteString(v)} LIMIT 1`, 1);
    if (r.rows[0]?.[0] !== undefined && r.rows[0]?.[0] !== null) {
      title = String(r.rows[0][0]);
      titleFrom = l.column;
      break;
    }
  }
  // 이름 열이 없으면 name, 이름 같은 열, 그것도 없으면 memo, 설명 같은 메모 열을 이름 대신 쓴다(보상 그룹의 memo).
  for (const pattern of [/^(name|title|이름|명칭)$/i, /^(memo|desc|description|comment|note|설명|비고|메모)$/i]) {
    if (title) break;
    const nameColumn = columns.find((c) => pattern.test(c));
    if (nameColumn && cell(nameColumn)) {
      title = cell(nameColumn);
      titleFrom = nameColumn;
    }
  }
  if (depth > 0) return { ...base, found: true, title, titleFrom };

  // 주요 값: ID 열과 이름 열을 빼고 앞에서부터. 다른 테이블을 쓰는 값은 그 행의 이름을 붙인다(한 단계만).
  const firstColumn = columns[0];
  const fields: ExplainField[] = [];
  for (const c of columns) {
    if (c === firstColumn || c === target.column || c === titleFrom) continue;
    if (fields.length >= MAX_FIELDS) break;
    const v = cell(c);
    if (v === null) continue;
    const field: ExplainField = { column: c, value: v };
    const link = info?.out.find((l) => l.column === c);
    if (link) {
      const nested = await compute(model, { key: link.key, column: link.otherColumn }, v, 1).catch(() => null);
      if (nested) field.meaning = nested.found ? (nested.title ?? `${nested.table}에 있음`) : `${nested.table}에 없는 ID`;
    }
    fields.push(field);
  }

  // 세부 행: 이 테이블을 부모로 두는 세부 테이블(보상 그룹 → 보상)에서 같은 ID의 행.
  const children: Explanation["children"] = [];
  const idValue = cell(firstColumn) ?? value;
  for (const t of model.tables.values()) {
    if (t.parent !== target.key) continue;
    const link = t.out.find((l) => l.key === target.key);
    if (!link) continue;
    const c = split(t.key);
    const cols = await columnsOf(model, t.key);
    const w = focusWhere({ column: link.column, value: idValue });
    const n = Number((await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${qualifiedTable(c.sourceId, c.table)} WHERE ${w}`, 1)).rows[0]?.[0] ?? 0);
    if (!n) continue;
    const sample = await runQuery(`SELECT * FROM ${qualifiedTable(c.sourceId, c.table)} WHERE ${w} LIMIT 3`, 3);
    const samples: string[] = [];
    for (const r of sample.rows) {
      const parts: string[] = [];
      for (const [i, name] of cols.entries()) {
        const v = r[i];
        if (name === link.column || v === null || v === undefined || parts.length >= 4) continue;
        parts.push(`${name} ${String(v)}${await typedName(model, cols, r, name, String(v))}`);
      }
      samples.push(parts.join(", "));
    }
    children.push({ table: c.table, key: t.key, count: n, samples });
  }

  // 쓰이는 곳: 이 행의 ID를 쓰는 다른 테이블의 행 수.
  const usedBy: Explanation["usedBy"] = [];
  for (const l of (info?.in ?? []).filter((l) => l.column === firstColumn).slice(0, MAX_USED_BY * 2)) {
    if (children.some((c) => c.key === l.key)) continue;
    const c = split(l.key);
    const n = Number(
      (await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${qualifiedTable(c.sourceId, c.table)} WHERE ${focusWhere({ column: l.otherColumn, value: idValue })}`, 1)).rows[0]?.[0] ?? 0,
    );
    // 같은 테이블의 여러 열(item_id, bonus_item_id_1)에서 쓰면 한 줄로 합친다.
    const same = usedBy.find((u) => u.table === c.table);
    if (n && same) {
      same.count += n;
      same.column += `, ${l.otherColumn}`;
    } else if (n) usedBy.push({ table: c.table, column: l.otherColumn, count: n });
    if (usedBy.length >= MAX_USED_BY) break;
  }

  return { ...base, found: true, title, titleFrom, fields, children, usedBy };
}

// 타입+ID 열(reward_type ITEM, reward_id 101821)에서 ID의 이름을 찾는다. 타입 값과 이름이 같은 테이블(ITEM → Item)의 첫 열에서 찾는다.
// 참조 방식 확장(16단계) 전이라 연결로 저장되지는 않고, 설명에서만 쓴다.
async function typedName(model: DomainModel, columns: string[], row: unknown[], column: string, value: string) {
  const m = column.match(/^(.*?)_?(id|no|code)$/i);
  if (!m) return "";
  const typeColumn = columns.find((c) => c.toLowerCase() === `${m[1]}_type`.toLowerCase() || c.toLowerCase() === `${m[1]}type`.toLowerCase());
  const typeValue = typeColumn ? row[columns.indexOf(typeColumn)] : null;
  if (typeValue === null || typeValue === undefined) return "";
  const wanted = String(typeValue).toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = [...model.tables.values()].find((t) => t.table.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted);
  if (!target) return "";
  const first = (await columnsOf(model, target.key))[0];
  if (!first) return "";
  const nested = await compute(model, { key: target.key, column: first }, value, 1).catch(() => null);
  if (!nested) return "";
  return nested.found ? (nested.title ? `(${nested.title})` : "") : `(${target.table}에 없는 ID)`;
}
