import type { ParsedDoc } from "@/core/doc-import";

// 기획서에서 테이블, 열, ID로 보이는 말을 뽑는다.
// name: 영문 식별자나 "~ 테이블" 앞의 말, 문서 표의 머리글
// id: 키로 보이는 4~7자리 숫자
// quoted: 「」, "" 안의 이름. 다국어 문자열 테이블로 실제 행을 찾는다.
export type TermKind = "name" | "id" | "quoted";

export interface DocTerm {
  key: string; // 매칭을 저장할 때 쓰는 키. 문서가 달라도 같은 말이면 같은 키다.
  text: string;
  kind: TermKind;
  sections: string[]; // 나온 절 id
  header: boolean; // 문서 표의 머리글로 나왔는지
  columns: string[]; // 문서 표의 칸에 나왔으면 그 칸의 머리글. ID가 어느 열의 값인지 가리는 데 쓴다.
}

export function termKey(kind: TermKind, text: string) {
  return `${kind}:${kind === "name" ? text.toLowerCase() : text}`;
}

const SNAKE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const CAPITAL_WORD = /\b[A-Z][a-z]{3,}\b/g;
const BEFORE_TABLE = /([A-Za-z가-힣][A-Za-z0-9가-힣_]*)\s*(?:테이블|table)/gi;
const NUMBER = /(?<![\d.])\d{4,7}(?![\d.])/g;
const QUOTED = /[「『“"]([^」』”"]{2,30})[」』”"]/g;

// 표 머리글 중 테이블이나 열 이름이 아닌 흔한 말은 뺀다.
const STOP_WORDS = new Set(["이름", "설명", "비고", "메모", "내용", "번호", "No", "no"]);

export function extractTerms(doc: ParsedDoc): DocTerm[] {
  const terms = new Map<string, DocTerm>();
  function add(kind: TermKind, raw: string, sectionId: string, header = false, column?: string) {
    const text = raw.trim();
    if (!text || STOP_WORDS.has(text)) return;
    const key = termKey(kind, text);
    const term = terms.get(key) ?? { key, text, kind, sections: [], header: false, columns: [] };
    if (!term.sections.includes(sectionId)) term.sections.push(sectionId);
    term.header ||= header;
    if (column && !term.columns.includes(column)) term.columns.push(column);
    terms.set(key, term);
  }

  function scan(text: string, sectionId: string, column?: string) {
    for (const m of text.matchAll(SNAKE)) add("name", m[0], sectionId);
    for (const m of text.matchAll(PASCAL)) add("name", m[0], sectionId);
    for (const m of text.matchAll(CAPITAL_WORD)) add("name", m[0], sectionId);
    for (const m of text.matchAll(BEFORE_TABLE)) add("name", m[1], sectionId);
    for (const m of text.matchAll(NUMBER)) add("id", m[0], sectionId, false, column);
    for (const m of text.matchAll(QUOTED)) add("quoted", m[1], sectionId);
  }

  for (const section of doc.sections) {
    for (const text of [section.title, ...section.lines]) scan(text, section.id);
    for (const table of section.tables) {
      for (const h of table.header) add("name", h, section.id, true);
      for (const row of table.rows) row.forEach((cell, i) => scan(cell, section.id, table.header[i]));
    }
  }
  return [...terms.values()];
}
