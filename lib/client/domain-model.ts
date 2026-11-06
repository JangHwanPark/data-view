import { fromColumns, type Relation } from "@/lib/client/relations";

// 도메인 지도(설계 4.12)의 계산. 테이블 목록과 관계만으로 도메인, 역할, 도메인 사이 연결을 정한다.
// 화면과 DuckDB에 기대지 않는 순수 함수라 같은 입력이면 같은 결과가 나온다.

export type TableRole = "start" | "base" | "child" | "shared" | "isolated";

// 표시 순서. 색도 이 순서로 범주형 1~4번을 고정해서 쓰고, 독립은 회색이다.
export const ROLE_ORDER: TableRole[] = ["start", "base", "child", "shared", "isolated"];

export const ROLE_LABEL: Record<TableRole, string> = {
  start: "콘텐츠",
  base: "정의",
  child: "세부",
  shared: "공용",
  isolated: "연결 없음",
};

export const ROLE_HELP: Record<TableRole, string> = {
  start: "플레이어가 직접 만나는 콘텐츠 테이블입니다(퀘스트, 상점 상품, 스테이지). 다른 테이블을 쓰기만 하고 이 테이블을 쓰는 곳은 없어서, 테스트를 시작하기 좋은 곳입니다.",
  base: "다른 테이블이 가져다 쓰는 정의 테이블입니다(퀘스트 조건, NPC). 여기를 바꾸면 이 테이블을 쓰는 곳도 같이 확인해야 합니다.",
  child: "다른 테이블의 한 줄을 자세히 적은 테이블입니다(장비는 아이템의 세부, 보상은 보상 그룹의 세부). 같은 ID로 위 테이블과 짝을 이루므로 같이 봐야 합니다.",
  shared: "여러 시스템이 함께 쓰는 공용 테이블입니다(아이템, 재화, 등급, 보상 그룹). 바꾸면 영향이 넓습니다.",
  isolated: "다른 테이블과 이어진 곳을 찾지 못했습니다. 이어져 있는데 안 보이면 연결 목록에서 직접 이어 주세요.",
};

// 공통으로 보는 기준: 자기 도메인 밖에서 이 수 이상의 도메인이 가리킨다.
const SHARED_DOMAINS = 3;

export interface ModelInput {
  tables: { sourceId: string; table: string; sourceName: string; sourceKind: string; firstColumn: string | null }[];
  relations: Relation[];
  overrides: Record<string, string>; // 테이블 키 → 사용자가 고른 도메인
}

export interface LinkEnd {
  key: string; // 상대 테이블 키
  column: string; // 이 테이블 쪽 열
  otherColumn: string; // 상대 테이블 쪽 열
  relationId: string;
  separator?: string; // 쓰는 쪽 열이 한 칸에 여러 ID를 넣을 때 구분자
  when?: { column: string; value: string }; // 쓰는 쪽이 타입+ID일 때 이 조건인 행만
  group?: string[]; // 쓰는 쪽이 번호 붙은 열 묶음(Level#1~3)일 때 묶음의 모든 열. 값을 찾을 때 모든 열을 본다
}

export interface TableInfo {
  key: string;
  sourceId: string;
  table: string;
  domain: string;
  autoDomain: string; // 사용자가 바꾸기 전의 도메인
  role: TableRole;
  parent: string | null; // 하위 테이블의 부모 테이블 키
  out: LinkEnd[]; // 이 테이블이 가리키는 쪽
  in: LinkEnd[]; // 이 테이블을 가리키는 쪽
}

export interface DomainInfo {
  name: string;
  tables: string[]; // 테이블 키
  out: Map<string, number>; // 가리키는 도메인 → 연결 수
  in: Map<string, number>;
  level: number; // 지도에서 왼쪽(0)부터 몇 번째 열인지
}

export interface DomainModel {
  tables: Map<string, TableInfo>;
  domains: DomainInfo[];
}

export const modelKey = (sourceId: string, table: string) => `${sourceId}/${table}`;

export function splitKey(key: string) {
  const slash = key.indexOf("/");
  return { sourceId: key.slice(0, slash), table: key.slice(slash + 1) };
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

// QuestCondition → Quest, quest_condition → quest. 다음 글자가 대문자거나 _일 때만 접두어로 본다.
function isPrefix(prefix: string, name: string) {
  if (prefix.length >= name.length || !name.startsWith(prefix)) return false;
  const next = name[prefix.length];
  return next === "_" || (next >= "A" && next <= "Z");
}

export function buildModel({ tables, relations, overrides }: ModelInput): DomainModel {
  const keys = new Set(tables.map((t) => modelKey(t.sourceId, t.table)));
  const infos = new Map<string, TableInfo>();

  // 1. 연결 모으기. 같은 테이블 안의 연결(이전 퀘스트 → 퀘스트)은 역할 판단에서 뺀다.
  const outs = new Map<string, LinkEnd[]>();
  const ins = new Map<string, LinkEnd[]>();
  for (const r of relations) {
    const a = modelKey(r.from.sourceId, r.from.table);
    const b = modelKey(r.to.sourceId, r.to.table);
    if (a === b || !keys.has(a) || !keys.has(b)) continue;
    // 번호 붙은 열 묶음은 열마다 따로 잇는다. 연결 그림에서 열 하나하나가 선으로 보이게 하려는 목적이다.
    const group = fromColumns(r.from);
    const extra = {
      ...(r.from.separator ? { separator: r.from.separator } : {}),
      ...(r.from.when ? { when: r.from.when } : {}),
      ...(group.length > 1 ? { group } : {}),
    };
    for (const column of group) {
      outs.set(a, [...(outs.get(a) ?? []), { key: b, column, otherColumn: r.to.column, relationId: r.id, ...extra }]);
      ins.set(b, [...(ins.get(b) ?? []), { key: a, column: r.to.column, otherColumn: column, relationId: r.id, ...extra }]);
    }
  }

  // 2. 부모: 첫 열이 다른 테이블을 가리키면 그 테이블의 하위다.
  const parentOf = new Map<string, string>();
  for (const t of tables) {
    const key = modelKey(t.sourceId, t.table);
    const link = t.firstColumn ? (outs.get(key) ?? []).find((l) => l.column === t.firstColumn) : undefined;
    if (link) parentOf.set(key, link.key);
  }

  // 3. 자동 도메인. 파일은 파일 이름, DB는 같은 소스 안의 가장 짧은 이름 접두어.
  const auto = new Map<string, string>();
  for (const t of tables) {
    const key = modelKey(t.sourceId, t.table);
    if (t.sourceKind !== "mysql") {
      auto.set(key, stripExtension(t.sourceName));
      continue;
    }
    const prefixes = tables
      .filter((o) => o.sourceId === t.sourceId && isPrefix(o.table, t.table))
      .sort((x, y) => x.table.length - y.table.length);
    auto.set(key, prefixes[0]?.table ?? t.table);
  }
  // 접두어로 묶이지 않고 혼자 남은 DB 하위 테이블은 부모의 도메인으로 보낸다(Equipment → Item).
  const size = (name: string) => [...auto.values()].filter((d) => d === name).length;
  for (const t of tables) {
    const key = modelKey(t.sourceId, t.table);
    const parent = parentOf.get(key);
    if (t.sourceKind === "mysql" && parent && size(auto.get(key)!) === 1) auto.set(key, auto.get(parent)!);
  }

  const domainOf = (key: string) => overrides[key] || auto.get(key)!;

  // 4. 역할
  for (const t of tables) {
    const key = modelKey(t.sourceId, t.table);
    const out = outs.get(key) ?? [];
    const inn = ins.get(key) ?? [];
    const domain = domainOf(key);
    const outsideDomains = new Set(inn.map((l) => domainOf(l.key)).filter((d) => d !== domain));
    let role: TableRole;
    if (!out.length && !inn.length) role = "isolated";
    else if (parentOf.has(key)) role = "child";
    else if (outsideDomains.size >= SHARED_DOMAINS) role = "shared";
    else if (inn.length) role = "base";
    else role = "start";
    infos.set(key, {
      key,
      sourceId: t.sourceId,
      table: t.table,
      domain,
      autoDomain: auto.get(key)!,
      role,
      parent: parentOf.get(key) ?? null,
      out: dedupeEnds(out),
      in: dedupeEnds(inn),
    });
  }

  // 5. 도메인과 도메인 사이 연결 수
  const domains = new Map<string, DomainInfo>();
  for (const info of infos.values()) {
    const d: DomainInfo = domains.get(info.domain) ?? { name: info.domain, tables: [], out: new Map(), in: new Map(), level: 0 };
    d.tables.push(info.key);
    domains.set(info.domain, d);
  }
  for (const info of infos.values()) {
    for (const l of info.out) {
      const target = infos.get(l.key)!.domain;
      if (target === info.domain) continue;
      const from = domains.get(info.domain)!;
      const to = domains.get(target)!;
      from.out.set(target, (from.out.get(target) ?? 0) + 1);
      to.in.set(info.domain, (to.in.get(info.domain) ?? 0) + 1);
    }
  }
  const list = [...domains.values()];
  assignLevels(list);
  const roleRank = (key: string) => ROLE_ORDER.indexOf(infos.get(key)!.role);
  for (const d of list) d.tables.sort((a, b) => roleRank(a) - roleRank(b) || infos.get(a)!.table.localeCompare(infos.get(b)!.table));
  list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { tables: infos, domains: list };
}

// 같은 상대와 같은 열로 이어진 연결이 저장 관계와 자동 연결에 둘 다 있으면 하나만 남긴다.
function dedupeEnds(list: LinkEnd[]) {
  const seen = new Map<string, LinkEnd>();
  for (const l of list) {
    const k = `${l.key}|${l.column}|${l.otherColumn}|${l.when?.value ?? ""}`;
    if (!seen.has(k)) seen.set(k, l);
  }
  return [...seen.values()];
}

// 지도의 왼쪽에서 오른쪽 순서. 많이 가리켜지는 도메인일수록 오른쪽(공통 쪽)에 둔다.
// 도메인 사이에는 순환(퀘스트 ↔ 보상)이 흔해서, "가리켜지는 정도"가 큰 쪽으로 가는 선만 남겨 순환을 끊고 가장 긴 경로로 층을 나눈다.
function assignLevels(domains: DomainInfo[]) {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const score = new Map(domains.map((d) => [d.name, sum(d.in) - sum(d.out)]));
  const before = (a: string, b: string) => score.get(a)! < score.get(b)! || (score.get(a) === score.get(b) && a < b);
  const order = [...domains].sort((a, b) => (before(a.name, b.name) ? -1 : 1));
  const level = new Map<string, number>(domains.map((d) => [d.name, 0]));
  for (const d of order) {
    for (const target of d.out.keys()) {
      if (before(d.name, target)) level.set(target, Math.max(level.get(target)!, level.get(d.name)! + 1));
    }
  }
  for (const d of domains) d.level = level.get(d.name)!;
}
