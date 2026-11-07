import { parseGlossary } from "@/lib/client/doc-infer";
import { parseWordCsv } from "@/lib/client/korean-name";
import type { Dashboard, SavedChart } from "@/lib/client/opfs";
import { buildExport, parseExport, remapRelations, type Relation, type RelationsExport } from "@/lib/client/relations";

// 팀 공유 설정(PLAN.md 30단계, 5-9). 한 사람이 다듬은 설정을 한 파일로 내보내 QA실이 같이 쓴다.
// 들어가는 것: 확인한 참조 관계, 단어 사전 csv(테이블 한글 이름), 기획서 이름 짝(용어집), 바꾼 시스템(도메인), 지금 테이블 한글 이름 목록(참고용).
// 소스는 id가 PC마다 다르므로 파일 이름으로 다시 맞춘다. 데이터 값, 접속 정보, 기획서 내용은 넣지 않는다.

export interface TeamSettings {
  app: "data-view";
  kind: "team-settings";
  version: 1;
  exportedAt: string;
  relations: RelationsExport;
  words: string; // 단어 사전 csv
  glossary: string; // 한글=English 줄
  domains: { source: string; table: string; domain: string }[];
  tableNames: { source: string; table: string; korean: string; inferred: boolean }[]; // 참고용, 가져올 때 쓰지 않는다
  charts?: SavedChart[]; // 저장한 차트(34단계). 소스는 이름으로 다시 맞춘다
  dashboard?: Dashboard;
}

export function buildTeamSettings(input: {
  relations: Relation[];
  sources: { id: string; name: string; tables: string[] }[];
  words: string;
  glossary: string;
  domains: Record<string, string>; // 테이블 키 → 시스템
  names: Map<string, { text: string; inferred: boolean }>;
  charts?: SavedChart[];
  dashboard?: Dashboard;
}): TeamSettings {
  const nameOf = new Map(input.sources.map((s) => [s.id, s.name]));
  const split = (key: string) => ({ sourceId: key.slice(0, key.indexOf("/")), table: key.slice(key.indexOf("/") + 1) });
  return {
    app: "data-view",
    kind: "team-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    relations: buildExport(input.relations, input.sources),
    words: input.words,
    glossary: input.glossary,
    domains: Object.entries(input.domains).flatMap(([key, domain]) => {
      const { sourceId, table } = split(key);
      const source = nameOf.get(sourceId);
      return source ? [{ source, table, domain }] : [];
    }),
    charts: input.charts ?? [],
    dashboard: input.dashboard,
    tableNames: input.sources.flatMap((s) =>
      s.tables.flatMap((table) => {
        const n = input.names.get(`${s.id}/${table}`);
        return n ? [{ source: s.name, table, korean: n.text, inferred: n.inferred }] : [];
      }),
    ),
  };
}

export function parseTeamSettings(text: string): TeamSettings {
  const data = JSON.parse(text) as Partial<TeamSettings>;
  if (data.app !== "data-view" || data.kind !== "team-settings" || data.version !== 1) throw new Error("data-view에서 내보낸 팀 공유 설정 파일이 아닙니다.");
  parseExport(JSON.stringify(data.relations));
  return data as TeamSettings;
}

// 단어 사전 합치기: 지금 사전에 가져온 줄을 더한다. 같은 영어 단어가 있으면 가져온 뜻으로 바꾼다.
export function mergeWords(current: string, incoming: string) {
  // 줄마다 비교용 키(소문자, 밑줄 없앰)로 맞추되, 적힌 글자 그대로 남긴다(Prise가 prise로 바뀌지 않게).
  const lines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !/^english\s*[,\t]\s*korean$/i.test(l));
  const keyOf = (line: string) => [...parseWordCsv(line).keys()][0];
  const merged = new Map<string, string>();
  for (const l of lines(current)) if (keyOf(l)) merged.set(keyOf(l)!, l);
  const before = parseWordCsv(current);
  let changed = 0;
  for (const l of lines(incoming)) {
    const k = keyOf(l);
    if (!k) continue;
    if (before.get(k) !== parseWordCsv(l).get(k)) changed++;
    merged.set(k, l);
  }
  return { text: [...merged.values()].join("\n"), changed };
}

// 용어집 합치기: 한글 말이 같으면 가져온 영어로 바꾼다.
export function mergeGlossary(current: string, incoming: string) {
  const before = parseGlossary(current);
  const merged = new Map([...before, ...parseGlossary(incoming)]);
  const changed = [...parseGlossary(incoming)].filter(([ko, en]) => before.get(ko) !== en).length;
  return { text: [...merged].map(([ko, en]) => `${ko}=${en}`).join("\n"), changed };
}

// 소스 이름으로 지금 소스 id를 찾는다. 이름이 같은 소스가 하나뿐일 때만 맞춘다.
export function sourceMapping(names: { id: string; name: string }[], current: { id: string; name: string }[]) {
  const map: Record<string, string> = {};
  for (const s of names) {
    const hits = current.filter((c) => c.name === s.name);
    if (hits.length === 1) map[s.id] = hits[0].id;
  }
  return map;
}

export function importRelations(data: TeamSettings, current: { id: string; name: string }[], existing: Relation[]) {
  return remapRelations(data.relations, sourceMapping(data.relations.sources, current), existing);
}

export function importDomains(data: TeamSettings, current: { id: string; name: string; tables: string[] }[]) {
  const out: { key: string; domain: string }[] = [];
  let skipped = 0;
  for (const d of data.domains) {
    const hits = current.filter((c) => c.name === d.source && c.tables.includes(d.table));
    if (hits.length === 1) out.push({ key: `${hits[0].id}/${d.table}`, domain: d.domain });
    else skipped++;
  }
  return { out, skipped };
}

// 저장한 차트 합치기: 같은 이름의 차트가 있으면 가져온 것으로 바꾸고, 없으면 더한다. 대시보드에 있던 차트는 대시보드에도 넣는다.
export function mergeCharts(current: SavedChart[], dash: Dashboard, data: TeamSettings) {
  const incoming = data.charts ?? [];
  const byTitle = new Map(current.map((c) => [c.title, c]));
  const charts = [...current];
  const items = [...dash.items];
  let added = 0;
  for (const c of incoming) {
    const old = byTitle.get(c.title);
    const next = { ...c, id: old?.id ?? c.id };
    if (old) charts[charts.indexOf(old)] = next;
    else {
      charts.push(next);
      added++;
    }
    if (data.dashboard?.items.some((i) => i.chartId === c.id) && !items.some((i) => i.chartId === next.id)) {
      items.push({ chartId: next.id, wide: data.dashboard.items.find((i) => i.chartId === c.id)!.wide });
    }
  }
  return { charts, dashboard: { ...dash, items }, added, replaced: incoming.length - added };
}
