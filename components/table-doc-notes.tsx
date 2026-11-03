"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { nameRefersToTable, parseGlossary } from "@/lib/client/doc-infer";
import { extractTerms } from "@/lib/client/doc-terms";

const MAX_LINES = 4;

interface Note {
  docId: string;
  docName: string;
  sectionId: string;
  sectionTitle: string;
  lines: string[];
  tables: number; // 이 테이블의 열을 머리글로 가진 기획서 표 수
  words: string[]; // 강조할 말
}

// 테이블 화면의 "기획서 설명". 이 테이블을 가리키는 말이 나오는 기획서 절을 찾아 그 문장을 보여준다.
// 가리키는 말: 이 테이블로 확정한 용어, 이름이 같은 말(QuestTable, Quest), 용어집으로 바꾸면 같은 말(퀘스트 테이블).
export function TableDocNotes({ table, columns }: { table: string; columns: string[] }) {
  const { docs, mappings, glossary } = useWorkspace();
  const glossaryMap = parseGlossary(glossary);
  // 같은 데이터를 파일과 DB로 둘 다 연 경우가 있어서, 확정한 대상은 소스와 상관없이 테이블 이름으로 맞춘다.
  const confirmed = new Set(mappings.filter((m) => m.target && m.target.table === table && !m.target.column).map((m) => m.key));

  const notes: Note[] = [];
  for (const doc of docs) {
    if (!doc.parsed) continue;
    const words = extractTerms(doc.parsed)
      .filter((t) => t.kind === "name" && (confirmed.has(t.key) || nameRefersToTable(t.text, table, glossaryMap)))
      .map((t) => t.text);
    if (!words.length) continue;
    // QuestCondition 속의 Quest처럼 다른 이름의 일부로 나온 경우는 세지 않는다.
    const pattern = wordPattern(words);
    for (const section of doc.parsed.sections) {
      const all = [section.title, ...section.lines];
      const lines = all.filter((line) => new RegExp(pattern.source).test(line));
      const tables = section.tables.filter((t) => t.header.some((h) => columns.includes(h))).length;
      if (!lines.length) continue;
      notes.push({
        docId: doc.meta.id,
        docName: doc.meta.name,
        sectionId: section.id,
        sectionTitle: section.title,
        // 절 제목에만 나오면 본문 첫 문장들을 대신 보여준다.
        lines: (lines.length === 1 && lines[0] === section.title ? section.lines : lines.filter((l) => l !== section.title)).slice(0, MAX_LINES),
        tables,
        words,
      });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="inline-flex items-center gap-1 text-zinc-500">
        <BookOpen className="size-3.5" aria-hidden />
        기획서 설명
      </p>
      {notes.length === 0 ? (
        <p className="text-zinc-400">
          {docs.length === 0 ? "열어 둔 기획서가 없습니다." : `기획서에서 ${table} 테이블을 설명하는 내용을 찾지 못했습니다. 기획서에 다른 이름으로 적혀 있으면 기획서 화면에서 용어를 이 테이블로 확정해 주세요.`}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
          {notes.map((n) => (
            <li key={`${n.docId}/${n.sectionId}`} className="rounded border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
              <Link href={`/docs/${n.docId}#${n.sectionId}`} className="flex flex-wrap items-baseline gap-x-1.5 hover:underline">
                <span className="text-zinc-500">{n.docName}</span>
                <span className="font-medium">{n.sectionTitle}</span>
                {n.tables > 0 && <span className="text-zinc-400">표 {n.tables}개</span>}
              </Link>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-700 dark:text-zinc-300">
                {n.lines.map((line, i) => (
                  <li key={i}>
                    <Emphasis text={line} words={n.words} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 영문 이름은 앞뒤가 영문, 숫자, _가 아닐 때만 그 단어로 본다.
function wordPattern(words: string[]) {
  const alternatives = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![A-Za-z0-9_])(${alternatives.join("|")})(?![A-Za-z0-9_])`, "g");
}

function Emphasis({ text, words }: { text: string; words: string[] }) {
  const pattern = wordPattern(words);
  return (
    <>
      {text.split(pattern).map((part, i) =>
        words.includes(part) ? (
          <strong key={i} className="font-semibold text-zinc-900 dark:text-zinc-100">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
