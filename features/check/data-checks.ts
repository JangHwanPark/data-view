import type { DomainModel } from "@/core/domain-model";
import { runQuery } from "@/core/duckdb";
import { inactiveIds, qualifiedTable, tableRules } from "@/core/file-import";
import { cleanValue, TOP_LIMIT } from "./integrity";
import { fromValuesSql, normSql, type FromSide } from "@/core/relations";
import { quoteIdent, quoteString } from "@/shared/lib/query-result";

// 데이터 점검 넓히기(PLAN 35단계).
// 1. 아무도 쓰지 않는 행: 다른 테이블이 참조하는 테이블에서, 어느 참조하는 곳도 쓰지 않는 Id. 예: 어디서도 주지 않는 아이템.
// 2. 기획 설명이 가리키는 없는 테이블: #Design 설명의 <테이블>이 불러온 데이터에 없을 때(오타, 옛 이름).
// 3. 이름이 한두 글자 다른 테이블 쌍: FruitPrice와 FruitPrise처럼 오타로 갈라진 옛 시트일 수 있다.

export interface UnusedResult {
  key: string; // 테이블 키
  column: string; // Id 컬럼
  rows: number; // 비활성 행을 뺀 행 수
  unused: number; // 아무도 쓰지 않는 Id 수(비활성 행 제외)
  inactiveUnused: number; // 비활성 행 가운데 쓰지 않는 것(막아 둔 행이라 문제는 아님)
  referrers: string[]; // 살펴본 참조하는 곳(테이블.컬럼)
  top: string[]; // 쓰지 않는 Id(앞 TOP_LIMIT개)
}

const split = (key: string) => ({ sourceId: key.slice(0, key.indexOf("/")), table: key.slice(key.indexOf("/") + 1) });

async function firstColumn(sourceId: string, table: string) {
  return (await runQuery(`SELECT * FROM ${qualifiedTable(sourceId, table)} LIMIT 0`, 0)).columns[0]?.name;
}

export async function findUnused(model: DomainModel, key: string): Promise<UnusedResult | null> {
  const info = model.tables.get(key);
  if (!info || !info.in.length) return null;
  const { sourceId, table } = split(key);
  const idColumn = await firstColumn(sourceId, table);
  if (!idColumn) return null;
  // 같은 참조 관계(번호 붙은 열 묶음)는 한 번만 펼친다.
  // 참조하는 쪽도 자기 Id 열이면(Id → Id) 같은 Id로 이어 붙인 짝 테이블이라 「쓴다」고 보지 않는다.
  const seen = new Set<string>();
  const froms: FromSide[] = [];
  const referrers: string[] = [];
  for (const l of info.in) {
    if (l.column !== idColumn || seen.has(l.relationId)) continue;
    seen.add(l.relationId);
    const s = split(l.key);
    if (!l.group && (await firstColumn(s.sourceId, s.table)) === l.otherColumn) continue;
    froms.push({ sourceId: s.sourceId, table: s.table, column: l.otherColumn, ...(l.group ? { columns: l.group } : {}), ...(l.separator ? { separator: l.separator } : {}), ...(l.when ? { when: l.when } : {}) });
    referrers.push(`${s.table}.${l.group ? `${l.group[0]}~` : l.otherColumn}`);
  }
  if (!froms.length) return null;
  const off = [...inactiveIds(sourceId, table)];
  const id = normSql(quoteIdent(idColumn));
  const used = froms.map((f) => fromValuesSql(f)).join(" UNION ");
  const offSql = off.length ? `${id} IN (${off.map(quoteString).join(", ")})` : "false";
  const r = await runQuery(
    `WITH t AS (SELECT DISTINCT ${id} AS v, ${offSql} AS off FROM ${qualifiedTable(sourceId, table)} WHERE ${quoteIdent(idColumn)} IS NOT NULL),
     u AS (${used}),
     n AS (SELECT v, off FROM t WHERE v NOT IN (SELECT v FROM u))
     SELECT (SELECT CAST(count(*) AS BIGINT) FROM t WHERE NOT off), (SELECT CAST(count(*) AS BIGINT) FROM n WHERE NOT off), (SELECT CAST(count(*) AS BIGINT) FROM n WHERE off),
            (SELECT array_to_string(list(v ORDER BY TRY_CAST(v AS DOUBLE), v)[1:${TOP_LIMIT}], chr(31)) FROM n WHERE NOT off)`,
    1,
  );
  const [rows, unused, inactiveUnused, top] = r.rows[0] ?? [];
  return { key, column: idColumn, rows: Number(rows ?? 0), unused: Number(unused ?? 0), inactiveUnused: Number(inactiveUnused ?? 0), referrers, top: typeof top === "string" && top ? top.split("\u001f").map(cleanValue) : [] };
}

export interface BrokenDesignRef {
  key: string; // 설명이 있는 테이블
  column: string; // 설명 시트의 컬럼 이름
  text: string;
  target: string; // 설명이 가리키는 없는 테이블
  similar: string | null; // 불러온 테이블 가운데 가장 비슷한 이름
}

export function findBrokenDesignRefs(sources: { id: string; tables: string[] }[]): BrokenDesignRef[] {
  const all = sources.flatMap((s) => s.tables);
  const lower = new Set(all.map((t) => t.toLowerCase()));
  const out: BrokenDesignRef[] = [];
  for (const s of sources) {
    for (const t of s.tables) {
      for (const d of tableRules(s.id, t)?.descriptions ?? []) {
        for (const ref of d.refs) {
          if (lower.has(ref.table.toLowerCase())) continue;
          const best = all.map((x) => [x, distance(x.toLowerCase(), ref.table.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0];
          out.push({ key: `${s.id}/${t}`, column: d.column, text: d.text, target: ref.table, similar: best && best[1] <= Math.max(2, Math.floor(ref.table.length / 3)) ? best[0] : null });
        }
      }
    }
  }
  return out;
}

export interface SimilarPair {
  a: string; // 테이블 키
  b: string;
  distance: number; // 글자 차이
  sameTitle: string | null; // #Design 머리말이 같으면 그 머리말
}

// 이름이 한두 글자만 다른 테이블 쌍(다른 낱말이 8글자 미만이면 한 글자). 5글자 이상인 이름만 본다(Pet, Set 같은 짧은 이름은 우연히 비슷하다).
// 같은 이름(대소문자만 다름, 파일과 DB로 둘 다 연 복사본)은 뺀다.
// 오타는 낱말 하나 안에서 나므로, 낱말 수가 같고 한 낱말만 다른 쌍만 본다(Equipment와 EquipSet은 다른 낱말이다).
export function findSimilarNames(sources: { id: string; tables: string[] }[]): SimilarPair[] {
  const list = sources.flatMap((s) => s.tables.map((t) => ({ key: `${s.id}/${t}`, table: t, sourceId: s.id })));
  const out: SimilarPair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].table.toLowerCase();
      const b = list[j].table.toLowerCase();
      if (a === b || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 2) continue;
      const wa = words(list[i].table);
      const wb = words(list[j].table);
      const diff = wa.flatMap((w, k) => (w !== wb[k] ? [k] : []));
      // 숫자만 다르면(Stage1과 Stage2, P01Apple과 P02Apple) 번호를 붙인 다른 테이블이다.
      if (wa.length !== wb.length || diff.length !== 1 || /^\d+$/.test(wa[diff[0]]) || /^\d+$/.test(wb[diff[0]])) continue;
      const [x, y] = [wa[diff[0]], wb[diff[0]]];
      const d = distance(x, y);
      if (d === 0 || d > (Math.min(x.length, y.length) >= 8 ? 2 : 1)) continue;
      const ta = tableRules(list[i].sourceId, list[i].table)?.title ?? null;
      const tb = tableRules(list[j].sourceId, list[j].table)?.title ?? null;
      out.push({ a: list[i].key, b: list[j].key, distance: d, sameTitle: ta && ta === tb ? ta : null });
    }
  }
  return out.sort((x, y) => x.distance - y.distance || Number(!!y.sameTitle) - Number(!!x.sameTitle));
}

// 낱말 나누기: 큰 글자, _, 숫자에서 끊는다. FruitPrice → fruit, price / reward_daily → reward, daily
export function words(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// 글자 편집 거리(바꾸기, 넣기, 빼기 한 번이 1)
export function distance(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
