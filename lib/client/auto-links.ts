import { loadCatalog, normalizeName, type Catalog } from "@/lib/client/doc-infer";
import { coverage, relationStats, rowCoverage, sameEndpoints, type ColumnRef, type Relation } from "@/lib/client/relations";

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

const MIN_COVERAGE = 0.9;

const strip = (column: string) => normalizeName(column.replace(/[_\s]?(id|no|code|key|idx|index)$/i, ""));

// 번호 붙은 열(bonus_item_id_1)은 번호를 떼고 본다.
const unnumbered = (column: string) => column.replace(/_\d+$/, "");

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
  const me = catalog.tables.find((t) => t.sourceId === target.sourceId && t.table === target.table);
  if (!me) return [];
  // 이름이 같은 테이블은 같은 데이터를 파일과 DB로 둘 다 연 복사본이라 연결 후보에서 뺀다.
  const others = catalog.tables.filter((t) => t !== me && t.table !== me.table);
  // 같은 소스(같은 파일, 같은 DB) → 같은 종류(파일끼리, DB끼리) → 그 밖의 순서로 찾는다.
  // 게임 데이터는 여러 파일에 나뉘어 있어서, 같은 파일만 보면 다른 파일의 테이블을 놓친다.
  const prefer = <T extends { sourceId: string }>(list: T[]) => {
    const same = list.filter((t) => t.sourceId === me.sourceId);
    if (same.length) return same;
    const sameKind = list.filter((t) => kindOf(t.sourceId) === kindOf(me.sourceId));
    return sameKind.length ? sameKind : list;
  };

  const candidates: { from: ColumnRef; to: ColumnRef; reason: string }[] = [];
  for (const column of me.columns) {
    if (column === me.keyColumn) continue;
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
            ? `열 이름이 ${t.table}의 키(${t.keyColumn})와 같음`
            : `열 이름이 ${t.table}의 키(${t.keyColumn})를 담음`
          : `열 이름이 테이블 ${t.table}을 가리킴`,
      });
    }
  }
  if (me.keyColumn) {
    const myName = normalizeName(me.table);
    const referrers = others.flatMap((t) =>
      t.columns
        .filter((c) => c !== t.keyColumn || t.keyColumn === me.keyColumn)
        .filter((c) => namesKey(c, me.keyColumn!) || strip(c) === myName)
        .map((c) => ({ t, c })),
    );
    for (const { t, c } of prefer(referrers.map((r) => ({ ...r, sourceId: r.t.sourceId })))) {
      candidates.push({
        from: { sourceId: t.sourceId, table: t.table, column: c },
        to: { ...target, column: me.keyColumn },
        reason: namesKey(c, me.keyColumn) ? `${t.table}.${c}가 이 테이블의 키(${me.keyColumn})를 가리킴` : `${t.table}.${c}가 이 테이블 이름을 가리킴`,
      });
    }
  }

  const links: AutoLink[] = [];
  for (const c of candidates) {
    if (c.from.sourceId === c.to.sourceId && c.from.table === c.to.table && c.from.column === c.to.column) continue;
    const stats = await relationStats(c.from, c.to).catch(() => null);
    if (!stats || stats.fromDistinct === 0) continue;
    const ratio = Math.max(coverage(stats), rowCoverage(stats));
    if (ratio < MIN_COVERAGE) continue;
    links.push({
      relation: {
        id: `auto:${c.from.sourceId}/${c.from.table}.${c.from.column}>${c.to.sourceId}/${c.to.table}.${c.to.column}`,
        from: c.from,
        to: c.to,
      },
      reason: `${c.reason}, 값 ${Math.round(ratio * 1000) / 10}% 일치`,
    });
  }
  return links;
}

export function isAutoRelation(r: Relation) {
  return r.id.startsWith("auto:");
}
