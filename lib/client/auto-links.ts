import { loadCatalog, normalizeName, type Catalog } from "@/lib/client/doc-infer";
import { coverage, relationStats, sameEndpoints, type ColumnRef, type Relation } from "@/lib/client/relations";

// 실무 테이블은 이미 이어져 있다. 사용자가 관계 화면에서 하나하나 잇지 않아도,
// 테이블을 열 때 그 테이블의 열만 검사해서 이어진 테이블을 찾는다.
// - 가리키는 쪽: 열 이름이 다른 테이블의 키 열 이름과 같거나(reward_group_id → RewardGroup),
//   _id 따위를 뗀 열 이름이 테이블 이름과 같다(grade_id → Grade).
// - 가리켜지는 쪽: 이 테이블의 키 열 이름이나 이 테이블 이름 + _id를 열로 가진 다른 테이블.
// 찾은 후보는 값이 90% 이상 맞을 때만 연결로 본다. 같은 소스 안의 테이블을 먼저 본다.
export interface AutoLink {
  relation: Relation; // id는 auto:로 시작한다
  reason: string;
}

const MIN_COVERAGE = 0.9;

const strip = (column: string) => normalizeName(column.replace(/[_\s]?(id|no|code|key|idx|index)$/i, ""));

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
    const byKey = others.filter((t) => t.keyColumn === column);
    const byName = others.filter((t) => t.keyColumn && strip(column) && strip(column) === normalizeName(t.table));
    for (const t of prefer(byKey.length ? byKey : byName).slice(0, 3)) {
      candidates.push({
        from: { ...target, column },
        to: { sourceId: t.sourceId, table: t.table, column: t.keyColumn! },
        reason: byKey.length ? `열 이름이 ${t.table}의 키(${t.keyColumn})와 같음` : `열 이름이 테이블 ${t.table}을 가리킴`,
      });
    }
  }
  if (me.keyColumn) {
    const myName = normalizeName(me.table);
    const referrers = others.flatMap((t) =>
      t.columns
        .filter((c) => c !== t.keyColumn || t.keyColumn === me.keyColumn)
        .filter((c) => c === me.keyColumn || strip(c) === myName)
        .map((c) => ({ t, c })),
    );
    for (const { t, c } of prefer(referrers.map((r) => ({ ...r, sourceId: r.t.sourceId })))) {
      candidates.push({
        from: { sourceId: t.sourceId, table: t.table, column: c },
        to: { ...target, column: me.keyColumn },
        reason: c === me.keyColumn ? `${t.table}에 이 테이블의 키(${c})와 같은 이름의 열이 있음` : `${t.table}.${c}가 이 테이블 이름을 가리킴`,
      });
    }
  }

  const links: AutoLink[] = [];
  for (const c of candidates) {
    if (c.from.sourceId === c.to.sourceId && c.from.table === c.to.table && c.from.column === c.to.column) continue;
    const stats = await relationStats(c.from, c.to).catch(() => null);
    if (!stats || stats.fromDistinct === 0) continue;
    const ratio = coverage(stats);
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
