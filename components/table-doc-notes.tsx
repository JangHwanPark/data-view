"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Hash, Loader2 } from "lucide-react";
import { sourceVersion, useWorkspace, type WorkspaceDoc } from "@/components/workspace-provider";
import { idsInTable, nameRefersToTable, parseGlossary, type DocMapping } from "@/lib/client/doc-infer";
import { tableHref, valuePattern, type RowFocus } from "@/lib/client/doc-links";
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
interface Props {
  sourceId: string;
  table: string;
  columns: string[];
  focus: RowFocus | null; // 기획서에서 연 행
  narrow?: boolean; // 좁은 칸(관계도의 정보 칸)에 들어가면 한 줄에 하나씩 놓는다
}

export function TableDocNotes({ sourceId, table, columns, focus, narrow }: Props) {
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
      {focus && <RowNotes focus={focus} />}
      <DocIds sourceId={sourceId} table={table} focus={focus} />
      <p className="inline-flex items-center gap-1 text-zinc-500">
        <BookOpen className="size-3.5" aria-hidden />
        기획서 설명
      </p>
      {notes.length === 0 ? (
        <p className="text-zinc-400">
          {docs.length === 0 ? "열어 둔 기획서가 없습니다." : `기획서에서 ${table} 테이블을 설명하는 내용을 찾지 못했습니다. 기획서에 다른 이름으로 적혀 있으면 기획서 화면에서 용어를 이 테이블로 확정해 주세요.`}
        </p>
      ) : (
        <ul className={`grid grid-cols-1 gap-1.5 ${narrow ? "" : "xl:grid-cols-2"}`}>
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

interface RowNote {
  docId: string;
  docName: string;
  sectionId: string;
  sectionTitle: string;
  lines: string[];
}

// 기획서에서 이 값이 나오는 절과 문장. 문서 표에 나왔으면 그 행을 "머리글: 값" 꼴로 보여준다.
function findValue(docs: WorkspaceDoc[], value: string): RowNote[] {
  const pattern = valuePattern(value);
  const notes: RowNote[] = [];
  for (const doc of docs) {
    if (!doc.parsed) continue;
    for (const section of doc.parsed.sections) {
      const lines = [section.title, ...section.lines].filter((l) => pattern.test(l));
      for (const t of section.tables) {
        for (const row of t.rows) {
          if (row.some((cell) => pattern.test(cell))) {
            lines.push(row.map((cell, i) => (t.header[i] ? `${t.header[i]}: ${cell}` : cell)).filter((c) => c.trim()).join(", "));
          }
        }
      }
      if (lines.length) {
        notes.push({ docId: doc.meta.id, docName: doc.meta.name, sectionId: section.id, sectionTitle: section.title, lines: lines.slice(0, MAX_LINES) });
      }
    }
  }
  return notes;
}

// 테이블 화면의 "관련 기획서" 중 행 단위. 기획서에서 연 행의 ID가 나오는 절을 보여주고, 누르면 그 절로 간다.
function RowNotes({ focus }: { focus: RowFocus }) {
  const { docs } = useWorkspace();
  const notes = findValue(docs, focus.value);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="inline-flex items-center gap-1 text-zinc-500">
        <BookOpen className="size-3.5" aria-hidden />이 행이 나오는 기획서 ({focus.column} = {focus.value})
      </p>
      {notes.length === 0 ? (
        <p className="text-zinc-400">{docs.length === 0 ? "열어 둔 기획서가 없습니다." : `기획서에 ${focus.value}가 나오지 않습니다.`}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
          {notes.map((n) => (
            <li key={`${n.docId}/${n.sectionId}`} className="rounded border border-blue-200 bg-white px-2.5 py-1.5 dark:border-blue-900 dark:bg-zinc-900">
              <Link href={`/docs/${n.docId}#${n.sectionId}`} className="flex flex-wrap items-baseline gap-x-1.5 hover:underline">
                <span className="text-zinc-500">{n.docName}</span>
                <span className="font-medium">{n.sectionTitle}</span>
              </Link>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-700 dark:text-zinc-300">
                {n.lines.map((line, i) => (
                  <li key={i}>
                    <Emphasis text={line} words={[focus.value]} />
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

const MAX_IDS = 40;

// 기획서 ID 중 다른 테이블로 확정했거나 무시한 것은 이 테이블의 ID로 보지 않는다.
function candidateIds(docs: WorkspaceDoc[], mappings: DocMapping[], sourceId: string, table: string) {
  const sections = new Map<string, Set<string>>(); // ID -> 나온 절 제목들
  for (const doc of docs) {
    if (!doc.parsed) continue;
    const titles = new Map(doc.parsed.sections.map((s) => [s.id, s.title]));
    for (const t of extractTerms(doc.parsed)) {
      if (t.kind !== "id") continue;
      const m = mappings.find((x) => x.key === t.key);
      if (m && (!m.target || m.target.table !== table || m.target.sourceId !== sourceId)) continue;
      const set = sections.get(t.text) ?? new Set<string>();
      for (const id of t.sections) set.add(`${doc.meta.name} ${titles.get(id) ?? ""}`.trim());
      sections.set(t.text, set);
    }
  }
  return sections;
}

// "기획서에 나온 ID": 기획서에 적힌 숫자 중 이 테이블의 키에 있는 값. 누르면 그 행을 연다.
function DocIds({ sourceId, table, focus }: { sourceId: string; table: string; focus: RowFocus | null }) {
  const { docs, mappings, sources } = useWorkspace();
  const source = sources.find((s) => s.meta.id === sourceId);
  const sections = candidateIds(docs, mappings, sourceId, table);
  const ids = [...sections.keys()];
  const requestKey = source?.status === "ready" && ids.length ? JSON.stringify([sourceVersion(source), table, ids]) : null;
  const [loaded, setLoaded] = useState<{ key: string; keyColumn: string | null; found: string[] } | null>(null);
  const result = loaded?.key === requestKey ? loaded : null;

  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    idsInTable(sourceId, table, ids)
      .then((r) => active && setLoaded({ key: requestKey, ...r }))
      .catch(() => active && setLoaded({ key: requestKey, keyColumn: null, found: [] }));
    return () => {
      active = false;
    };
    // ids와 테이블은 requestKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (!requestKey) return null;
  if (!result) {
    return (
      <p className="inline-flex items-center gap-1 text-zinc-400">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        기획서에 나온 ID를 찾는 중
      </p>
    );
  }
  const { keyColumn, found } = result;
  if (!keyColumn || found.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="inline-flex shrink-0 items-center gap-1 text-zinc-500" title={`기획서에 적힌 숫자 중 ${keyColumn}에 있는 값`}>
        <Hash className="size-3.5" aria-hidden />
        기획서에 나온 ID {found.length}개
      </span>
      {found.slice(0, MAX_IDS).map((v) => {
        const current = focus?.column === keyColumn && focus.value === v;
        return (
          <Link
            key={v}
            href={tableHref(sourceId, table, { column: keyColumn, value: v })}
            title={[...(sections.get(v) ?? [])].join("\n")}
            className={`rounded border px-1.5 py-0.5 tabular-nums ${current ? "border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200" : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"}`}
          >
            {v}
          </Link>
        );
      })}
      {found.length > MAX_IDS && <span className="text-zinc-400">외 {found.length - MAX_IDS}개</span>}
    </div>
  );
}
