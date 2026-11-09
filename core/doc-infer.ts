import { runQuery } from "@/core/duckdb";
import { qualifiedTable } from "@/core/file-import";
import type { DocTerm } from "@/core/doc-terms";
import { loadColumns, tableKey } from "@/core/schema";
import { stringKeyColumn, textColumn } from "@/core/string-table";
import { mostlyUnique, quoteIdent, quoteString } from "@/shared/lib/query-result";

export interface DocTarget {
  sourceId: string;
  table: string;
  column?: string;
  value?: string; // 따옴표 이름이 가리키는 행의 key 값. 다국어 문자열 key라서 기획서 글과 다르다.
}

export interface Candidate {
  target: DocTarget;
  score: number; // 0~1
  reason: string;
  exact?: boolean; // 같은 이름(정규화 후)의 테이블이나 열이 실제로 있음. 여러 곳에 있어 점수가 낮아도 옛 이름은 아니다.
}

// 확정한 매칭. target이 null이면 "무시"로 확정한 것이다.
export interface DocMapping {
  key: string;
  text: string;
  target: DocTarget | null;
}

interface CatalogTable {
  sourceId: string;
  table: string;
  columns: string[];
  keyColumn: string | null; // 첫 열이 유일한 값이면 키로 본다
}

export interface Catalog {
  tables: CatalogTable[];
  strings: { sourceId: string; table: string; keyColumn: string; textColumns: string[] } | null;
}

// 기본 용어집. 사용자가 "한글=English" 줄로 고칠 수 있다.
export const DEFAULT_GLOSSARY = `아이템=Item
보상=Reward
퀘스트=Quest
몬스터=Monster
스테이지=Stage
캐릭터=Character
스킬=Skill
상점=Shop
상품=Product
가챠=Gacha
뽑기=Gacha
소환=Gacha
제작=Recipe
재료=Material
재화=Currency
등급=Grade
펫=Pet
이벤트=Event
미션=Mission
출석=Attendance
패스=Pass
칭호=Title
업적=Achievement
던전=Dungeon
드랍=Drop
버프=Buff
효과=Effect
우편=Mail
메일=Mail
쿠폰=Coupon
길드=Guild
챕터=Chapter
지역=Map
맵=Map
대화=Dialog
조건=Condition
그룹=Group
레벨=Level
코스튬=Costume
패키지=Package
튜토리얼=Tutorial
장비=Equipment
세트=Set
능력치=Stat
풀=Pool
반복=Repeat`;

export function parseGlossary(text: string) {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [ko, en] = line.split("=").map((s) => s?.trim());
    if (ko && en) map.set(ko, en);
  }
  return map;
}

// 테이블 목록, 열, 키 열, 다국어 문자열 테이블을 모은다.
export async function loadCatalog(tables: { sourceId: string; table: string }[]): Promise<Catalog> {
  const columns = await loadColumns();
  const result: CatalogTable[] = [];
  for (const t of tables) {
    const cols = (columns.get(tableKey(t.sourceId, t.table)) ?? []).map((c) => c.name);
    let keyColumn: string | null = null;
    if (cols[0]) {
      const r = await runQuery(
        `SELECT count(*), count(DISTINCT ${quoteIdent(cols[0])}), count(${quoteIdent(cols[0])}) FROM ${qualifiedTable(t.sourceId, t.table)}`,
        1,
      );
      const [n, distinct, nonNull] = (r.rows[0] ?? []).map(Number);
      // 실제 데이터에는 실수로 들어간 중복 키가 섞여 있곤 해서, 98% 이상 유일하면 키로 본다.
      if (mostlyUnique(n, distinct, nonNull)) keyColumn = cols[0];
    }
    result.push({ ...t, columns: cols, keyColumn });
  }
  // key 열과 ko/en 같은 글 열을 가진 테이블을 다국어 문자열 테이블로 본다.
  // 회사 시트는 Key, Korean, English처럼 대문자로 쓰므로 대소문자를 가리지 않는다(25단계).
  const str = result.find((t) => stringKeyColumn(t.columns) && textColumn(t.columns));
  const strKey = str ? stringKeyColumn(str.columns)! : "";
  return {
    tables: result,
    strings: str ? { sourceId: str.sourceId, table: str.table, keyColumn: strKey, textColumns: str.columns.filter((c) => c !== strKey) } : null,
  };
}

const SUFFIX = /(table|tbl|data|info|list|테이블|정보|데이터|목록|시트)$/;

export function normalizeName(s: string) {
  let n = s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  while (SUFFIX.test(n) && n.replace(SUFFIX, "").length >= 2) n = n.replace(SUFFIX, "");
  if (n.length > 4 && n.endsWith("s") && !n.endsWith("ss")) n = n.slice(0, -1);
  return n;
}

function tokens(s: string) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.toLowerCase())
    .filter((t) => t && !/^(table|tbl|data|info|list|테이블|정보|데이터|목록)$/.test(t));
}

function editRatio(a: string, b: string) {
  if (!a || !b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

// 한글 용어를 용어집으로 영어 단어 목록으로 바꾼다. 영문이면 그대로 둔다.
function translate(text: string, glossary: Map<string, string>) {
  if (!/[가-힣]/.test(text)) return null;
  const words: string[] = [];
  const used: string[] = [];
  // 긴 용어부터 맞춰서 "퀘스트 보상" 같은 말을 단어별로 바꾼다.
  let rest = text.replace(/\s+/g, "");
  for (const ko of [...glossary.keys()].sort((a, b) => b.length - a.length)) {
    if (rest.includes(ko)) {
      words.push(glossary.get(ko)!);
      used.push(`${ko}=${glossary.get(ko)}`);
      rest = rest.replace(ko, "");
    }
  }
  return words.length ? { english: words.join(""), used } : null;
}

function scoreTable(term: string, table: string, glossary: Map<string, string>): Omit<Candidate, "target"> | null {
  const t = normalizeName(term);
  const n = normalizeName(table);
  if (!t || !n) return null;
  if (t === n) return { score: 0.95, reason: "이름이 같음", exact: true };

  const translated = translate(term, glossary);
  if (translated && normalizeName(translated.english) === n) {
    return { score: 0.85, reason: `기획서 이름 짝: ${translated.used.join(", ")}` };
  }

  const source = translated ? tokens(translated.english.replace(/([a-z])([A-Z])/g, "$1 $2")) : tokens(term);
  const target = tokens(table);
  const overlap = target.filter((w) => source.includes(w));
  let best: Omit<Candidate, "target"> | null = null;
  if (overlap.length) {
    const union = new Set([...source, ...target]).size;
    const jaccard = overlap.length / union;
    // 옛 이름 QuestReward가 실제 Reward를 품는 경우처럼 실제 이름의 단어가 모두 들어 있으면 더 높게 본다.
    const contained = overlap.length === target.length;
    const score = contained ? 0.6 + 0.2 * jaccard : 0.45 + 0.3 * jaccard;
    best = { score, reason: `이름 일부가 같음: ${overlap.join(", ")}` };
  }
  const ratio = editRatio(t, n);
  if (ratio >= 0.75 && (!best || ratio * 0.8 > best.score)) {
    best = { score: ratio * 0.8, reason: "이름이 비슷함(오타나 옛 이름)" };
  }
  return best;
}

// 이름 용어의 후보: 테이블 이름, 그리고 snake_case나 표 머리글이면 열 이름도 본다.
function nameCandidates(term: DocTerm, catalog: Catalog, glossary: Map<string, string>): Candidate[] {
  const out: Candidate[] = [];
  for (const t of catalog.tables) {
    const s = scoreTable(term.text, t.table, glossary);
    if (s && s.score >= 0.45) out.push({ target: { sourceId: t.sourceId, table: t.table }, ...s });
  }
  if (term.text.includes("_") || term.header) {
    const exact = catalog.tables.filter((t) => t.columns.includes(term.text));
    // 여러 테이블에 있는 열 이름이면, 그 열이 키인 테이블(reward_group_id라면 RewardGroup)을 대표로 본다.
    const homes = exact.filter((t) => t.keyColumn === term.text);
    const names = distinctNames(exact);
    for (const t of exact) {
      const home = homes.includes(t);
      out.push({
        target: { sourceId: t.sourceId, table: t.table, column: term.text },
        score: home ? 0.9 : names === 1 ? 0.9 : 0.6,
        reason: home ? "이 컬럼이 ID 열인 테이블" : names === 1 ? "같은 이름의 컬럼" : `같은 이름의 컬럼이 ${names}개 테이블에 있음`,
        exact: true,
      });
    }
  }
  return dedupe(out).slice(0, 6);
}

// 같은 데이터를 파일과 DB로 둘 다 열면 같은 이름의 테이블이 여러 소스에 생긴다. 이름이 같으면 한 테이블로 센다.
function distinctNames(tables: { table: string }[]) {
  return new Set(tables.map((t) => t.table)).size;
}

// 같은 대상에 대한 후보가 여러 규칙에서 나오면 점수가 높은 것 하나만 남긴다.
function dedupe(list: Candidate[]) {
  const best = new Map<string, Candidate>();
  for (const c of list) {
    const k = `${c.target.sourceId}/${c.target.table}/${c.target.column ?? ""}`;
    if (!best.has(k) || best.get(k)!.score < c.score) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// ID 숫자: 어느 테이블의 키 열에 있는지 본다. 테이블 하나에만 있으면 확실한 편이다.
async function idCandidates(terms: DocTerm[], catalog: Catalog): Promise<Map<string, Candidate[]>> {
  const result = new Map<string, Candidate[]>();
  const numbers = terms.map((t) => Number(t.text)).filter(Number.isFinite);
  if (numbers.length === 0) return result;
  const values = numbers.map((n) => `(${n})`).join(",");
  for (const t of catalog.tables) {
    if (!t.keyColumn) continue;
    const r = await runQuery(
      `SELECT DISTINCT v FROM (VALUES ${values}) AS n(v)
       WHERE v IN (SELECT TRY_CAST(${quoteIdent(t.keyColumn)} AS BIGINT) FROM ${qualifiedTable(t.sourceId, t.table)})`,
      numbers.length,
    );
    for (const [v] of r.rows) {
      const key = String(v);
      const list = result.get(key) ?? [];
      list.push({ target: { sourceId: t.sourceId, table: t.table, column: t.keyColumn }, score: 0, reason: "" });
      result.set(key, list);
    }
  }
  const byText = new Map(terms.map((t) => [t.text, t]));
  for (const [key, list] of result) {
    const names = distinctNames(list.map((c) => c.target));
    // 기획서 표의 quest_id 칸에 나온 값이면, 그 이름의 열을 가진 후보를 맞는 쪽으로 본다.
    const columns = byText.get(key)?.columns ?? [];
    for (const c of list) {
      const fromHeader = columns.includes(c.target.column ?? "");
      if (names === 1) {
        c.score = 0.9;
        c.reason = `${c.target.table}의 ${c.target.column}에만 있는 ID`;
      } else if (fromHeader) {
        c.score = 0.9;
        c.reason = `기획서 표의 ${c.target.column} 칸에 나온 값`;
      } else {
        c.score = 0.6;
        c.reason = `이 ID가 있는 테이블이 ${names}개`;
      }
    }
    result.set(key, list.sort((a, b) => b.score - a.score));
  }
  return result;
}

// 따옴표 안 이름: 다국어 문자열 테이블에서 글을 찾아 key를 얻고, 그 key를 쓰는 열을 찾는다.
async function quotedCandidates(term: DocTerm, catalog: Catalog): Promise<Candidate[]> {
  if (!catalog.strings) return [];
  const s = catalog.strings;
  const where = s.textColumns.map((c) => `CAST(${quoteIdent(c)} AS VARCHAR) = ${quoteString(term.text)}`).join(" OR ");
  const keys = await runQuery(`SELECT ${quoteIdent(s.keyColumn)} FROM ${qualifiedTable(s.sourceId, s.table)} WHERE ${where}`, 5);
  const out: Candidate[] = [];
  for (const [k] of keys.rows) {
    const key = String(k);
    for (const t of catalog.tables) {
      if (t.sourceId === s.sourceId && t.table === s.table) continue;
      for (const col of t.columns.filter((c) => /key$/i.test(c))) {
        const hit = await runQuery(`SELECT 1 FROM ${qualifiedTable(t.sourceId, t.table)} WHERE ${quoteIdent(col)} = ${quoteString(key)}`, 1);
        if (hit.rowCount) {
          out.push({ target: { sourceId: t.sourceId, table: t.table, column: col, value: key }, score: 0.9, reason: `글자 테이블에서 "${term.text}"의 이름표(${key})를 찾아, 그 이름표를 쓰는 ${t.table}의 ${col}` });
        }
      }
    }
  }
  return out;
}

export async function inferAll(terms: DocTerm[], catalog: Catalog, glossaryText: string) {
  const glossary = parseGlossary(glossaryText);
  const result = new Map<string, Candidate[]>();
  const ids = await idCandidates(terms.filter((t) => t.kind === "id"), catalog);
  for (const term of terms) {
    if (term.kind === "name") result.set(term.key, nameCandidates(term, catalog, glossary));
    else if (term.kind === "id") result.set(term.key, ids.get(term.text) ?? []);
    else result.set(term.key, await quotedCandidates(term, catalog));
  }
  return result;
}

// 기획서의 말이 이 테이블 이름을 가리키는지. 정규화한 이름이 같거나, 한글이면 용어집으로 바꿨을 때 같은 경우다.
// 테이블 화면의 "기획서 설명"이 빠르게 쓰도록 값 조회 없이 이름만 본다.
export function nameRefersToTable(text: string, table: string, glossary: Map<string, string>) {
  const n = normalizeName(table);
  if (!n) return false;
  if (normalizeName(text) === n) return true;
  const translated = translate(text, glossary);
  return translated !== null && normalizeName(translated.english) === n;
}

// 값은 둘 다 있을 때만 비교한다. 행 값을 넣기 전에 확정한 매칭도 같은 대상으로 보기 위해서다.
export function sameTarget(a: DocTarget, b: DocTarget) {
  const sameValue = a.value === undefined || b.value === undefined || a.value === b.value;
  return a.sourceId === b.sourceId && a.table === b.table && (a.column ?? "") === (b.column ?? "") && sameValue;
}

// 기획서에 나온 ID 중 이 테이블의 키 열에 실제로 있는 값. 테이블 화면의 "기획서에 나온 ID"가 쓴다.
// 키 열은 후보 계산과 같은 기준(첫 열이 98% 이상 유일)으로 정한다.
export async function idsInTable(sourceId: string, table: string, ids: string[]) {
  const catalog = await loadCatalog([{ sourceId, table }]);
  const keyColumn = catalog.tables[0]?.keyColumn ?? null;
  const numbers = [...new Set(ids)].map(Number).filter(Number.isFinite);
  if (!keyColumn || numbers.length === 0) return { keyColumn, found: [] as string[] };
  const values = numbers.map((n) => `(${n})`).join(",");
  const r = await runQuery(
    `SELECT DISTINCT v FROM (VALUES ${values}) AS n(v)
     WHERE v IN (SELECT TRY_CAST(${quoteIdent(keyColumn)} AS BIGINT) FROM ${qualifiedTable(sourceId, table)})
     ORDER BY v`,
    numbers.length,
  );
  return { keyColumn, found: r.rows.map(([v]) => String(v)) };
}
