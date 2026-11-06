import { loadCatalog, normalizeName, type Catalog } from "@/lib/client/doc-infer";
import { runQuery } from "@/lib/client/duckdb";
import { isMemoColumn, qualifiedTable, tableRules } from "@/lib/client/file-import";
import { quoteIdent } from "@/lib/query-result";
import { coverage, fromColumns, isExtended, relationStats, rowCoverage, type FromSide, sameEndpoints, type ColumnRef, type Relation } from "@/lib/client/relations";

// 실무 테이블은 이미 이어져 있다. 사용자가 관계 화면에서 하나하나 잇지 않아도,
// 테이블을 열 때 그 테이블의 열만 검사해서 이어진 테이블을 찾는다.
// - 가리키는 쪽: 열 이름이 다른 테이블의 키 열 이름과 같거나(reward_group_id → RewardGroup),
//   앞에 쓰임새가 붙은 키 열 이름이거나(sell_currency_id, free_reward_group_id, bonus_item_id_1),
//   _id 따위를 뗀 열 이름이 테이블 이름과 같다(grade_id → Grade).
// - 가리켜지는 쪽: 이 테이블의 키 열 이름(쓰임새가 붙은 것 포함)이나 이 테이블 이름 + _id를 열로 가진 다른 테이블.
// 찾은 후보는 값이 90% 이상 맞을 때만 연결로 본다(고유값 기준이나 행 기준 중 높은 쪽). 같은 소스 안의 테이블을 먼저 본다.
export interface AutoLink {
  relation: Relation; // id는 auto:로 시작한다
  reason: string;
}

// 이름으로 찾은 후보는 값이 50% 이상 맞으면 연결로 본다(점선). 값으로만 찾은 후보는 90% 이상이어야 한다.
// 기획 설명(#Design)에 적힌 연결은 값이 덜 맞아도 연결로 둔다(실선). 맞지 않는 행 수는 근거에 적는다.
const MIN_COVERAGE = 0.9;
const MIN_NAME_COVERAGE = 0.5;

const strip = (column: string) => normalizeName(column.replace(/[_\s]?(id|no|code|key|idx|index)$/i, ""));

// 번호 붙은 열(bonus_item_id_1, Level#1)은 번호를 떼고 본다.
const unnumbered = (column: string) => column.replace(/(_|#)\d+$/, "");

// 번호 붙은 열의 묶음 이름. bonus_item_id_1 → bonus_item_id, material_id1 → material_id, Level#1 → Level(#).
// 회사 시트는 Level#1~3, Asset#1~2처럼 이름#번호로 적는다. 이 묶음은 이름이 id로 끝나지 않아도 ID 묶음으로 본다.
function numbered(column: string): { base: string; hash: boolean } | null {
  const m = column.match(/^(.+?)(_|#)?(\d+)$/);
  if (!m) return null;
  return { base: m[1].replace(/_$/, ""), hash: m[2] === "#" };
}
// 수량, 값처럼 ID가 아닌 묶음(item_count_1, Count#1).
const QUANTITY = /(count|cnt|amount|qty|num|value|rate|prob|weight|ratio|percent|min|max)$/i;
function isIdGroup(base: string, hash: boolean) {
  if (/(id|no|code|key)$/i.test(base)) return true;
  return hash && !QUANTITY.test(base);
}

// 열이 이 키 열을 가리키는 이름인지. 같거나, 쓰임새가 앞에 붙었다(sell_currency_id → currency_id).
// 키 열 이름이 id, no처럼 흔한 말이면 거의 모든 열 끝에 붙으므로 뒤쪽 일치를 보지 않는다.
// key는 다국어 문자열 테이블의 키라서 본다(name_key, title_key → String.key).
const GENERIC_KEYS = new Set(["id", "no", "idx", "index", "seq", "code", "num"]);
function namesKey(column: string, keyColumn: string) {
  const base = unnumbered(column);
  if (base === keyColumn) return true;
  if (GENERIC_KEYS.has(keyColumn.toLowerCase())) return false;
  return base.toLowerCase().endsWith(`_${keyColumn.toLowerCase()}`);
}

let catalogCache: { key: string; value: Promise<Catalog> } | null = null;
const linkCache = new Map<string, Promise<AutoLink[]>>();

// 데이터가 바뀌면(파일 교체, DB 다시 불러오기) version이 바뀌어 캐시를 새로 만든다.
function catalogFor(version: string, tables: { sourceId: string; table: string }[]) {
  if (catalogCache?.key !== version) {
    catalogCache = { key: version, value: loadCatalog(tables) };
    linkCache.clear();
    enumCache.clear();
  }
  return catalogCache.value;
}

// kinds: 소스 id → 종류("file" 또는 "db"). 같은 종류끼리 먼저 잇는 데 쓴다.
export function findAutoLinks(
  version: string,
  tables: { sourceId: string; table: string }[],
  target: { sourceId: string; table: string },
  saved: Relation[],
  kinds: Map<string, string>,
): Promise<AutoLink[]> {
  const key = `${version}|${target.sourceId}/${target.table}`;
  if (!linkCache.has(key)) {
    linkCache.set(
      key,
      catalogFor(version, tables).then((catalog) => compute(catalog, target, (id) => kinds.get(id) ?? "")),
    );
  }
  // 저장한 관계와 같은 것은 빼고 돌려준다. 저장 여부는 자주 바뀌므로 캐시하지 않는다.
  return linkCache.get(key)!.then((links) => links.filter((l) => !saved.some((r) => sameEndpoints(r, l.relation))));
}

async function compute(
  catalog: Catalog,
  target: { sourceId: string; table: string },
  kindOf: (sourceId: string) => string,
): Promise<AutoLink[]> {
  const found = catalog.tables.find((t) => t.sourceId === target.sourceId && t.table === target.table);
  if (!found) return [];
  // # 메모 열(#이름)은 DB에 없는 열이라 연결을 찾지 않는다(23단계).
  const withoutMemo = (t: CatalogTable) => ({ ...t, columns: t.columns.filter((c) => !isMemoColumn(t.sourceId, t.table, c)) });
  const me = withoutMemo(found);
  // 이름이 같은 테이블은 같은 데이터를 파일과 DB로 둘 다 연 복사본이라 연결 후보에서 뺀다.
  const others = catalog.tables.filter((t) => t !== found && t.table !== me.table).map(withoutMemo);
  // 같은 소스(같은 파일, 같은 DB) → 같은 종류(파일끼리, DB끼리) → 그 밖의 순서로 찾는다.
  // 게임 데이터는 여러 파일에 나뉘어 있어서, 같은 파일만 보면 다른 파일의 테이블을 놓친다.
  const prefer = <T extends { sourceId: string }>(list: T[]) => {
    const same = list.filter((t) => t.sourceId === me.sourceId);
    if (same.length) return same;
    const sameKind = list.filter((t) => kindOf(t.sourceId) === kindOf(me.sourceId));
    return sameKind.length ? sameKind : list;
  };

  const candidates: Candidate[] = [];
  const handled = new Set<string>();
  // 기획 설명(#Design, #Definition)의 <테이블>[컬럼]으로 찾는 연결을 가장 먼저 본다.
  const designFrom = new Set<string>(); // 다른 테이블에서 이 테이블을 가리킨다고 적힌 열(테이블.열)
  candidates.push(...designCandidates(me, others, prefer, handled, designFrom));
  // 번호 붙은 열 묶음, 한 칸 여러 ID, 종류+ID(17단계)를 먼저 찾는다. 여기서 다룬 열은 아래 단일 열 찾기에서 뺀다.
  candidates.push(...(await extendedCandidates(me, others, target, prefer, handled)));
  for (const column of me.columns) {
    if (column === me.keyColumn || handled.has(column)) continue;
    // 여러 키에 걸리면(free_reward_group_id는 reward_group_id와 group_id 둘 다) 가장 긴 키 이름을 고른다.
    const keyed = others.filter((t) => t.keyColumn && namesKey(column, t.keyColumn));
    const longest = Math.max(0, ...keyed.map((t) => t.keyColumn!.length));
    const byKey = keyed.filter((t) => t.keyColumn!.length === longest);
    const byName = others.filter((t) => t.keyColumn && strip(column) && strip(column) === normalizeName(t.table));
    for (const t of prefer(byKey.length ? byKey : byName).slice(0, 3)) {
      candidates.push({
        from: { ...target, column },
        to: { sourceId: t.sourceId, table: t.table, column: t.keyColumn! },
        reason: byKey.length
          ? column === t.keyColumn
            ? `열 이름이 ${t.table}의 ID 열(${t.keyColumn})과 같음`
            : `열 이름에 ${t.table}의 ID 열 이름(${t.keyColumn})이 들어 있음`
          : `열 이름이 ${t.table} 테이블 이름과 같음`,
      });
    }
  }
  if (me.keyColumn) {
    const myName = normalizeName(me.table);
    const referrers = others.flatMap((t) =>
      t.columns
        .filter((c) => c !== t.keyColumn || t.keyColumn === me.keyColumn)
        // 번호 붙은 열 묶음에 속한 열은 그 테이블에서 묶음으로 찾으므로 하나씩 잇지 않는다.
        .filter((c) => !inNumberedGroup(c, t.columns))
        // 기획 설명으로 이미 이 테이블을 가리킨다고 적힌 열은 다시 찾지 않는다.
        .filter((c) => !designFrom.has(`${t.sourceId}/${t.table}.${c}`))
        .filter((c) => namesKey(c, me.keyColumn!) || strip(c) === myName)
        .map((c) => ({ t, c })),
    );
    for (const { t, c } of prefer(referrers.map((r) => ({ ...r, sourceId: r.t.sourceId })))) {
      candidates.push({
        from: { sourceId: t.sourceId, table: t.table, column: c },
        to: { ...target, column: me.keyColumn },
        reason: namesKey(c, me.keyColumn) ? `${t.table}의 ${c} 열 이름에 이 테이블의 ID 열 이름(${me.keyColumn})이 들어 있음` : `${t.table}의 ${c} 열 이름이 이 테이블 이름과 같음`,
      });
    }
  }

  const links: (AutoLink & { ratio: number; exclusive?: string })[] = [];
  for (const c of candidates) {
    if (c.from.sourceId === c.to.sourceId && c.from.table === c.to.table && c.from.column === c.to.column && !isExtended(c.from)) continue;
    // 열거값 열(GOLD, SEED처럼 대문자 단어만 있는 Type 열)은 이름이 비슷해도 ID가 아니다.
    if (!c.design && (await isEnumColumn(c.from))) continue;
    const stats = await relationStats(c.from, c.to).catch(() => null);
    const extra = isExtended(c.from) ? `|${JSON.stringify([fromColumns(c.from), c.from.separator ?? "", c.from.when ?? null])}` : "";
    const id = `${c.design ? DESIGN_PREFIX : "auto:"}${c.from.sourceId}/${c.from.table}.${c.from.column}>${c.to.sourceId}/${c.to.table}.${c.to.column}${extra}`;
    if (c.design) {
      links.push({ relation: { id, from: c.from, to: c.to }, reason: stats && stats.fromRows > 0 ? `${c.reason}. ${matchText(stats)}` : c.reason, ratio: 1 });
      continue;
    }
    if (!stats || stats.fromDistinct === 0) continue;
    const ratio = Math.max(coverage(stats), rowCoverage(stats));
    // 값으로만 찾은 후보는 값 종류가 적으면 우연히 맞기 쉬워 고유값 기준으로도 90% 이상 맞아야 한다.
    if (ratio < (c.byValue ? MIN_COVERAGE : MIN_NAME_COVERAGE)) continue;
    if (c.byValue && (coverage(stats) < MIN_COVERAGE || stats.fromDistinct < 5)) continue;
    links.push({
      relation: { id, from: c.from, to: c.to },
      // QA가 읽기 쉽게 비율 대신 개수로 쓴다(설계 1.1). "3,000행 중 2,991행 맞음, 9행은 없는 ID"
      reason: `${c.reason}. ${matchText(stats)}`,
      ratio,
      exclusive: c.exclusive,
    });
  }
  // 기획 설명으로 찾은 연결과 같은 열, 같은 상대 테이블을 이름이나 값으로 또 찾았으면 기획 설명 쪽만 남긴다.
  const designLinks = links.filter((l) => isDesignRelation(l.relation));
  const covered = (l: (typeof links)[number]) =>
    designLinks.some(
      (d) =>
        d.relation.from.sourceId === l.relation.from.sourceId &&
        d.relation.from.table === l.relation.from.table &&
        d.relation.to.sourceId === l.relation.to.sourceId &&
        d.relation.to.table === l.relation.to.table &&
        fromColumns(l.relation.from).some((c) => fromColumns(d.relation.from).includes(c)),
    );
  const kept = links.filter((l) => isDesignRelation(l.relation) || !covered(l));
  // 같은 쓰는 쪽에 대상이 여럿이면(effect_ids → ItemEffect, SkillEffect) 가장 잘 맞는 하나만 남긴다.
  const best = new Map<string, number>();
  for (const l of kept) if (l.exclusive) best.set(l.exclusive, Math.max(best.get(l.exclusive) ?? 0, l.ratio));
  return kept.filter((l) => !l.exclusive || l.ratio === best.get(l.exclusive)).map(({ relation, reason }) => ({ relation, reason }));
}

interface Candidate {
  from: FromSide;
  to: ColumnRef;
  reason: string;
  exclusive?: string; // 같은 값이면 가장 잘 맞는 후보 하나만 남긴다
  byValue?: boolean; // 이름 없이 값으로만 찾은 후보
  design?: boolean; // 기획 설명(#Design)에 적힌 연결
}

const DESIGN_PREFIX = "auto:d:";

// 기획 설명(#Design, #Definition)에서 찾은 연결인지. 연결 그림에서 실선으로 그린다.
export function isDesignRelation(r: { id: string } | string) {
  return (typeof r === "string" ? r : r.id).startsWith(DESIGN_PREFIX);
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// 기획 설명의 <테이블>[컬럼]으로 찾는 후보. 이 테이블이 가리키는 것과, 다른 테이블의 설명이 이 테이블을 가리키는 것 둘 다 본다.
// [컬럼]이 없으면 상대 테이블의 ID 열(없으면 첫 열)을 가리키는 것으로 본다.
function designCandidates(
  me: CatalogTable,
  others: CatalogTable[],
  prefer: <T extends { sourceId: string }>(list: T[]) => T[],
  handled: Set<string>,
  designFrom: Set<string>,
): Candidate[] {
  const out: Candidate[] = [];
  const toColumn = (t: CatalogTable, column: string | null) => (column ? (t.columns.find((c) => sameName(c, column)) ?? null) : (t.keyColumn ?? t.columns[0] ?? null));
  const fromSide = (t: CatalogTable, cols: string[]): FromSide =>
    cols.length > 1 ? { sourceId: t.sourceId, table: t.table, column: cols[0], columns: cols } : { sourceId: t.sourceId, table: t.table, column: cols[0] };
  const reason = (from: string, text: string) => `기획 설명(${from === "design" ? "#Design" : "#Definition"})에 「${text}」라고 적혀 있음`;

  for (const d of tableRules(me.sourceId, me.table)?.descriptions ?? []) {
    const cols = d.columns.filter((c) => me.columns.includes(c));
    if (!cols.length) continue;
    for (const ref of d.refs) {
      const target = prefer(others.filter((t) => sameName(t.table, ref.table)))[0];
      const column = target && toColumn(target, ref.column);
      if (!target || !column) continue;
      out.push({ from: fromSide(me, cols), to: { sourceId: target.sourceId, table: target.table, column }, reason: reason(d.from, d.text), design: true });
      cols.forEach((c) => handled.add(c));
    }
  }
  for (const t of others) {
    for (const d of tableRules(t.sourceId, t.table)?.descriptions ?? []) {
      const cols = d.columns.filter((c) => t.columns.includes(c));
      if (!cols.length) continue;
      for (const ref of d.refs.filter((r) => sameName(r.table, me.table))) {
        const column = toColumn(me, ref.column);
        if (!column) continue;
        out.push({ from: fromSide(t, cols), to: { sourceId: me.sourceId, table: me.table, column }, reason: reason(d.from, d.text), design: true });
        cols.forEach((c) => designFrom.add(`${t.sourceId}/${t.table}.${c}`));
      }
    }
  }
  return out;
}

// 값이 모두 대문자 단어(GOLD, SEED, FRUIT)이고 종류가 50개 이하인 열. 종류를 적는 열이라 다른 테이블의 ID를 가리키지 않는다.
// 숫자가 섞인 값(STR_ITEM_1001)은 문자열 키라서 열거값으로 보지 않는다.
const enumCache = new Map<string, Promise<boolean>>();
function isEnumColumn(from: FromSide) {
  if (isExtended(from)) return Promise.resolve(false);
  const key = `${from.sourceId}/${from.table}.${from.column}`;
  if (!enumCache.has(key)) {
    const q = quoteIdent(from.column);
    enumCache.set(
      key,
      runQuery(
        `SELECT CAST(count(*) AS BIGINT), CAST(count(*) FILTER (WHERE regexp_matches(CAST(v AS VARCHAR), '^[A-Z][A-Z_]*$')) AS BIGINT)
         FROM (SELECT DISTINCT ${q} AS v FROM ${qualifiedTable(from.sourceId, from.table)} WHERE ${q} IS NOT NULL)`,
        1,
      )
        .then((r) => {
          const [n, words] = (r.rows[0] ?? []).map(Number);
          return n > 0 && n <= 50 && n === words;
        })
        .catch(() => false),
    );
  }
  return enumCache.get(key)!;
}

type CatalogTable = Catalog["tables"][number];

// 이 열이 ID를 담는 번호 붙은 열 묶음(bonus_item_id_1~3)에 속하는지. 묶음 기준은 extendedCandidates와 같다.
function inNumberedGroup(column: string, columns: string[]) {
  const n = numbered(column);
  if (!n || !isIdGroup(n.base, n.hash)) return false;
  return columns.filter((c) => numbered(c)?.base === n.base).length >= 2;
}
const SEPARATORS = ["|", ";", ",", "/"];
const SAMPLE_ROWS = 300;

// 쓰는 쪽 이름(base, 예: material_id, skill)이 가리키는 테이블. 이름으로 못 찾으면 빈 목록이다.
function tablesByName(base: string, others: CatalogTable[]) {
  const keyed = others.filter((t) => t.keyColumn && (namesKey(base, t.keyColumn) || namesKey(`${base}_id`, t.keyColumn)));
  const longest = Math.max(0, ...keyed.map((t) => t.keyColumn!.length));
  const byKey = keyed.filter((t) => t.keyColumn!.length === longest);
  if (byKey.length) return byKey;
  return others.filter((t) => t.keyColumn && strip(base) && strip(base) === normalizeName(t.table));
}

async function extendedCandidates(
  me: CatalogTable,
  others: CatalogTable[],
  target: { sourceId: string; table: string },
  prefer: <T extends { sourceId: string }>(list: T[]) => T[],
  handled: Set<string>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const keyedOthers = prefer(others.filter((t) => t.keyColumn));
  const push = (from: FromSide, list: CatalogTable[], reason: (t: CatalogTable) => string, exclusive: string, byValue = false) => {
    for (const t of list) out.push({ from, to: { sourceId: t.sourceId, table: t.table, column: t.keyColumn! }, reason: reason(t), exclusive, byValue });
  };

  // 1. 번호 붙은 열 묶음: 접두어가 같고 끝 번호만 다른 열이 둘 이상(material_id_1~5).
  const groups = new Map<string, string[]>();
  const hashed = new Set<string>();
  for (const c of me.columns) {
    const n = numbered(c);
    if (!n || c === me.keyColumn) continue;
    groups.set(n.base, [...(groups.get(n.base) ?? []), c]);
    if (n.hash) hashed.add(n.base);
  }
  for (const [base, cols] of groups) {
    if (cols.some((c) => handled.has(c))) continue; // 기획 설명으로 이미 찾은 묶음
    if (cols.length < 2 || !isIdGroup(base, hashed.has(base))) continue; // 수량, 값 열(item_count_1, Count#1)은 ID가 아니다
    const from: FromSide = { ...target, column: cols[0], columns: cols };
    const byName = prefer(tablesByName(base, others));
    const label = `${cols[0]}~${cols[cols.length - 1].match(/\d+$/)![0]}`;
    if (byName.length) push(from, byName.slice(0, 3), (t) => `번호 붙은 열 ${label}의 이름이 ${t.table}의 ID 열(${t.keyColumn})을 가리킴`, `n:${base}`);
    else push(from, keyedOthers, (t) => `번호 붙은 열 ${label}의 값이 ${t.table}의 ID와 맞음`, `n:${base}`, true);
    cols.forEach((c) => handled.add(c));
  }

  // 2. 한 칸 여러 ID: 표본에서 구분 글자가 자주 나오고, 나눈 조각이 거의 숫자인 열(skill_ids = 1001|1002).
  const sample = await runQuery(`SELECT * FROM ${qualifiedTable(me.sourceId, me.table)} LIMIT ${SAMPLE_ROWS}`, SAMPLE_ROWS).catch(() => null);
  for (const [i, col] of (sample?.columns ?? []).entries()) {
    if (col.type !== "string" || handled.has(col.name) || col.name === me.keyColumn) continue;
    const values = sample!.rows.map((r) => r[i]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    if (values.length < 5) continue;
    const sep = SEPARATORS.find((s) => values.filter((v) => v.includes(s)).length >= values.length * 0.2);
    if (!sep) continue;
    const parts = values.flatMap((v) => v.split(sep).map((p) => p.trim())).filter(Boolean);
    if (parts.filter((p) => /^-?\d+$/.test(p)).length < parts.length * 0.9) continue;
    const base = col.name.replace(/(_?ids|_?list|s)$/i, "");
    const from: FromSide = { ...target, column: col.name, separator: sep };
    const byName = prefer(tablesByName(base, others));
    if (byName.length) push(from, byName.slice(0, 3), (t) => `${col.name}은 ID를 ${sep}로 나눠 적은 열이고, 이름이 ${t.table}의 ID 열(${t.keyColumn})을 가리킴`, `s:${col.name}`);
    else push(from, keyedOthers, (t) => `${col.name}은 ID를 ${sep}로 나눠 적은 열이고, 값이 ${t.table}의 ID와 맞음`, `s:${col.name}`, true);
    handled.add(col.name);
  }

  // 3. 종류 + ID: reward_type과 reward_id처럼 접두어가 같은 종류 열과 ID 열. 종류 값마다 그 이름의 테이블을 가리킨다.
  for (const typeColumn of me.columns.filter((c) => /_?type$/i.test(c))) {
    const prefix = typeColumn.replace(/_?type$/i, "");
    const idColumn = me.columns.find((c) => c !== typeColumn && c.toLowerCase().replace(/_/g, "") === `${prefix}id`.toLowerCase().replace(/_/g, ""));
    if (!prefix || !idColumn) continue;
    const kinds = await runQuery(
      `SELECT DISTINCT CAST(${quoteIdent(typeColumn)} AS VARCHAR) FROM ${qualifiedTable(me.sourceId, me.table)} WHERE ${quoteIdent(typeColumn)} IS NOT NULL LIMIT 30`,
      30,
    ).catch(() => null);
    let found = false;
    for (const [kind] of kinds?.rows ?? []) {
      const wanted = normalizeName(String(kind));
      const list = prefer(others.filter((t) => t.keyColumn && normalizeName(t.table) === wanted));
      if (!list.length) continue;
      found = true;
      const from: FromSide = { ...target, column: idColumn, when: { column: typeColumn, value: String(kind) } };
      push(from, list.slice(0, 1), (t) => `${typeColumn}이 ${String(kind)}인 행의 ${idColumn}은 ${t.table}의 ID`, `t:${idColumn}:${String(kind)}`);
    }
    if (found) handled.add(idColumn);
  }
  return out;
}

export function isAutoRelation(r: Relation) {
  return r.id.startsWith("auto:");
}

// 연결 근거의 개수 문장. 행 기준으로 세고, 맞지 않는 행이 있으면 따로 적는다.
export function matchText(stats: { fromRows: number; matchedRows: number }) {
  const total = stats.fromRows.toLocaleString();
  const ok = stats.matchedRows.toLocaleString();
  const missing = stats.fromRows - stats.matchedRows;
  return missing > 0 ? `${total}행 중 ${ok}행 맞음, ${missing.toLocaleString()}행은 상대 테이블에 없는 ID` : `${total}행 모두 맞음`;
}
