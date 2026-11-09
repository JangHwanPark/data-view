import type { ParsedDoc } from "@/core/doc-import";
import { inferAll, loadCatalog, sameTarget, type Candidate, type DocMapping, type DocTarget } from "@/core/doc-infer";
import { extractTerms, type DocTerm } from "@/core/doc-terms";

export type TermState = "confirmed" | "ignored" | "candidate" | "unmatched";

export interface TermView {
  term: DocTerm;
  state: TermState;
  target: DocTarget | null; // 확정한 대상
  candidates: Candidate[];
}

// 후보 점수가 이 값 이상이면 확정 전이라도 "언급된 테이블"로 센다.
export const STRONG_SCORE = 0.85;

// 문서 여러 개의 용어를 합친다. 절 id 앞에 문서 id를 붙여 어느 문서의 절인지 남긴다.
export function mergeTerms(docs: { id: string; parsed: ParsedDoc }[]) {
  const merged = new Map<string, DocTerm>();
  for (const { id, parsed } of docs) {
    for (const t of extractTerms(parsed)) {
      const existing = merged.get(t.key);
      const sections = t.sections.map((s) => `${id}/${s}`);
      if (existing) {
        existing.sections.push(...sections);
        existing.header ||= t.header;
        existing.columns.push(...t.columns.filter((c) => !existing.columns.includes(c)));
      } else merged.set(t.key, { ...t, sections });
    }
  }
  return [...merged.values()];
}

export async function analyze(
  terms: DocTerm[],
  tables: { sourceId: string; table: string }[],
  glossary: string,
): Promise<Map<string, Candidate[]>> {
  const catalog = await loadCatalog(tables);
  return inferAll(terms, catalog, glossary);
}

export function viewTerms(terms: DocTerm[], candidates: Map<string, Candidate[]>, mappings: DocMapping[]): TermView[] {
  return terms.map((term) => {
    const mapping = mappings.find((m) => m.key === term.key);
    const list = candidates.get(term.key) ?? [];
    if (mapping) {
      // 행 값이 없는 예전 매칭은 같은 대상의 후보에서 값을 채워 행으로 갈 수 있게 한다.
      const target = mapping.target && (list.find((c) => sameTarget(c.target, mapping.target!))?.target ?? mapping.target);
      return { term, state: mapping.target ? "confirmed" : "ignored", target, candidates: list };
    }
    return { term, state: list.length ? "candidate" : "unmatched", target: null, candidates: list };
  });
}

// 확정했거나 확실한 후보가 있는 테이블. 이 밖의 테이블은 "기획서에 없음"으로 본다.
export function mentionedTables(views: TermView[]) {
  const set = new Set<string>();
  for (const v of views) {
    if (v.state === "confirmed" && v.target) set.add(`${v.target.sourceId}/${v.target.table}`);
    if (v.state === "candidate") {
      for (const c of v.candidates) if (c.score >= STRONG_SCORE) set.add(`${c.target.sourceId}/${c.target.table}`);
    }
  }
  return set;
}

export function isSelected(view: TermView, candidate: Candidate) {
  return view.target !== null && sameTarget(view.target, candidate.target);
}
