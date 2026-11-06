import type { ParsedDoc } from "@/lib/client/doc-import";

// 테이블 화면의 기획서 설명(PLAN.md 26단계, 3-4 3-7). 브라우저 없이 돌 수 있게 순수 함수만 둔다.
// - 설명 문장 고르기(3-4): 기획서 문장마다 점수를 매겨, 2점 이상이고 25자 이상인 문장 중 높은 것 2개
//   +3 테이블 이름(영어 이름이나 한글 이름)이 나옴
//   +2 이 테이블의 컬럼 이름이 나옴(Id처럼 흔한 이름은 뺌)
//   +1 무엇을 정하는 문장(정의한다, 관리한다, 넣는다, 참조 …)
//   -1 목차 줄이거나 숫자와 기호가 절반 넘는 줄
// - 관련 기획서(3-7): 테이블이 나오는 절을 제목 경로(1. 개요 > 1.1 과일 데이터 정의)로 묶어 문서별, 절 차례로 40개까지

export const MIN_SCORE = 2;
export const MIN_LENGTH = 25;
export const MAX_SENTENCES = 2;
export const MAX_RELATED = 40;

const GENERIC_COLUMNS = new Set(["id", "no", "key", "name", "type", "value", "count", "level"]);
const DEFINING = /(정의|관리|정한다|정하며|정해|넣는다|넣어|적는다|적어|쓴다|뜻한다|의미|기준|참조|가리킨|사용한다|지급|반영)/;

export interface TableWords {
  table: string; // 영어 이름
  korean: string | null; // 한글 이름(괄호 전)
  columns: string[];
  extra: string[]; // 기획서에서 이 테이블로 확정한 말 등
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 영문 이름은 앞뒤가 영문, 숫자, _가 아닐 때만 그 이름으로 본다. Level#처럼 #로 끝나면 뒤에 번호가 와도 된다.
// 한글 이름은 「과일 테이블」, 「과일(Fruit)」처럼 테이블을 가리킬 때만 본다(「과일 가격」 속의 「과일」은 세지 않는다).
function wordRegex(word: string, korean = false) {
  if (korean) return new RegExp(`${escape(word)}\\s*(테이블|\\()`);
  // 대소문자를 가린다. 「FRUIT 종류」 같은 열거값을 Fruit 테이블로 보지 않으려는 것이다.
  if (/^[A-Za-z0-9_#]+$/.test(word)) return new RegExp(`(?<![A-Za-z0-9_])${escape(word)}${word.endsWith("#") ? "" : "(?![A-Za-z0-9_])"}`);
  return new RegExp(escape(word));
}

export function tableNameWords(w: TableWords) {
  return [w.table, ...w.extra].filter(Boolean);
}

function nameIn(text: string, w: TableWords) {
  const english = tableNameWords(w).find((x) => wordRegex(x).test(text));
  if (english) return english;
  if (w.korean && wordRegex(w.korean, true).test(text)) return w.korean;
  return null;
}

export function mentionsTable(text: string, w: TableWords) {
  return nameIn(text, w) !== null;
}

export interface Scored {
  text: string;
  score: number;
  reasons: string[];
}

export function scoreSentence(text: string, w: TableWords, toc = false): Scored {
  let score = 0;
  const reasons: string[] = [];
  const name = nameIn(text, w);
  if (name) {
    score += 3;
    reasons.push(`테이블 이름(${name}) +3`);
  }
  const column = w.columns.find((c) => c.length >= 2 && !GENERIC_COLUMNS.has(c.toLowerCase()) && !c.startsWith("#") && wordRegex(c.replace(/#\d+$/, "#")).test(text));
  if (column) {
    score += 2;
    reasons.push(`컬럼 이름(${column}) +2`);
  }
  if (DEFINING.test(text)) {
    score += 1;
    reasons.push("정하는 말 +1");
  }
  const symbols = text.replace(/[\s가-힣A-Za-z]/g, "").length;
  if (toc || /\t\d+\s*$/.test(text) || symbols > text.replace(/\s/g, "").length / 2) {
    score -= 1;
    reasons.push(toc ? "목차 줄 -1" : "숫자·기호가 많음 -1");
  }
  return { text, score, reasons };
}

// 줄을 문장으로 나눈다. 마침표, 물음표, 느낌표 뒤의 공백에서 자른다.
export function sentences(line: string) {
  return line
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DocPlace {
  docId: string;
  docName: string;
  sectionId: string;
  title: string;
  path: string[];
}

export interface PickedSentence extends Scored, DocPlace {}

export function pickSentences(docs: { id: string; name: string; parsed: ParsedDoc }[], w: TableWords): PickedSentence[] {
  const all: (PickedSentence & { order: number })[] = [];
  let order = 0;
  for (const d of docs) {
    for (const s of d.parsed.sections) {
      for (const line of s.lines) {
        for (const sentence of sentences(line)) {
          const scored = scoreSentence(sentence, w);
          order++;
          if (scored.score < MIN_SCORE || sentence.length < MIN_LENGTH) continue;
          all.push({ ...scored, docId: d.id, docName: d.name, sectionId: s.id, title: s.title, path: s.path ?? [s.title], order });
        }
      }
    }
  }
  // 점수가 높은 것, 같으면 문서에서 먼저 나온 것. 같은 문장이 여러 번 나오면 한 번만.
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .filter((s) => !seen.has(s.text) && seen.add(s.text))
    .slice(0, MAX_SENTENCES)
    .map((s) => {
      const rest: PickedSentence & { order?: number } = { ...s };
      delete rest.order;
      return rest;
    });
}

export interface RelatedSection extends DocPlace {
  hits: number; // 테이블 이름이 나온 줄 수
  first: string; // 처음 나온 줄
}

export function relatedSections(docs: { id: string; name: string; parsed: ParsedDoc }[], w: TableWords) {
  const out: RelatedSection[] = [];
  for (const d of [...docs].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const s of d.parsed.sections) {
      const lines = [s.title, ...s.lines, ...s.tables.flatMap((t) => [t.header.join(" "), ...t.rows.map((r) => r.join(" "))])].filter((l) => mentionsTable(l, w));
      if (!lines.length) continue;
      out.push({ docId: d.id, docName: d.name, sectionId: s.id, title: s.title, path: s.path ?? [s.title], hits: lines.length, first: lines.find((l) => l !== s.title) ?? lines[0] });
    }
  }
  return { sections: out.slice(0, MAX_RELATED), total: out.length };
}
