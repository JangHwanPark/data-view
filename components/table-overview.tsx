"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDomainModel } from "@/components/use-domain-model";
import { useKoreanNames } from "@/components/use-korean-names";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { ROLE_LABEL } from "@/lib/client/domain-model";
import { pickSentences, type TableWords } from "@/lib/client/doc-notes";
import { runQuery } from "@/lib/client/duckdb";
import { inactiveIds, qualifiedTable, tableRules, twinInactive } from "@/lib/client/file-import";
import { quoteIdent } from "@/lib/query-result";

// 테이블 개요(PLAN.md 26단계, 3-3). 이 테이블이 무엇인지 줄마다 어디서 알아냈는지(출처)와 함께 적는다.
// 한글 이름(#Design 머리말 또는 사전 추론), 시스템과 역할, 기획서 설명 문장 2개(점수 규칙), 가리키는 쪽 설명(다른 테이블의 #Design),
// 값 예시(데이터 앞 3행, 비활성 행 제외).

interface Line {
  label: string;
  content: React.ReactNode;
  source: React.ReactNode;
  title?: string;
}

export function TableOverview({ sourceId, table, words }: { sourceId: string; table: string; words: TableWords }) {
  const { docs, sources } = useWorkspace();
  const { model } = useDomainModel();
  const names = useKoreanNames();
  const key = `${sourceId}/${table}`;
  const korean = names.get(key);
  const info = model?.tables.get(key);
  const examples = useExamples(sourceId, table);

  const parsedDocs = docs.filter((d) => d.parsed).map((d) => ({ id: d.meta.id, name: d.meta.name, parsed: d.parsed! }));
  const picked = pickSentences(parsedDocs, words);

  // 다른 테이블의 #Design 설명 중 이 테이블을 가리키는 것.
  const pointing: { from: string; column: string; text: string }[] = [];
  for (const s of sources) {
    if (s.status !== "ready") continue;
    for (const t of s.tables) {
      for (const d of tableRules(s.meta.id, t)?.descriptions ?? []) {
        if (d.refs.some((r) => r.table.toLowerCase() === table.toLowerCase())) pointing.push({ from: t, column: d.column, text: d.text });
      }
    }
  }

  const lines: Line[] = [];
  if (korean) {
    lines.push({
      label: "한글 이름",
      content: korean.text,
      source: korean.inferred ? "단어 사전으로 지음(추론)" : "엑셀 #Design 머리말",
    });
  }
  if (info) {
    lines.push({ label: "시스템", content: `${info.domain} 시스템 · ${ROLE_LABEL[info.role]}`, source: "앱이 연결을 보고 판단" });
  }
  for (const s of picked) {
    lines.push({
      label: "기획서 설명",
      content: s.text,
      title: `점수 ${s.score}: ${s.reasons.join(", ")}`,
      source: (
        <Link href={`/docs/${s.docId}?view=original#${s.sectionId}`} className="hover:underline">
          {s.docName} › {s.path.join(" › ")}
        </Link>
      ),
    });
  }
  for (const p of pointing.slice(0, 5)) {
    lines.push({ label: "가리키는 쪽 설명", content: `${p.from}.${p.column}: ${p.text}`, source: `${p.from} #Design` });
  }
  if (examples && examples.length) {
    lines.push({ label: "값 예시", content: examples.join(", "), source: "데이터 앞 3행(비활성 행 제외)" });
  }
  if (!lines.length) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-zinc-500">개요</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        {lines.map((l, i) => (
          <div key={i} className="contents">
            <dt className="whitespace-nowrap text-zinc-500">{l.label}</dt>
            <dd title={l.title}>
              <span className="text-zinc-800 dark:text-zinc-200">{l.content}</span>
              <span className="ml-1.5 text-[11px] text-zinc-400">출처: {l.source}</span>
            </dd>
          </div>
        ))}
      </dl>
      {docs.length > 0 && picked.length === 0 && (
        <p className="text-[11px] text-zinc-400">기획서에서 이 테이블을 설명하는 문장(2점 이상, 25자 이상)을 찾지 못했습니다.</p>
      )}
    </div>
  );
}

// 값 예시: 앞에서부터 비활성이 아닌 행 3개의 ID와 이름(#이름, name 같은 열이 있으면).
function useExamples(sourceId: string, table: string) {
  const { sources } = useWorkspace();
  const source = sources.find((s) => s.meta.id === sourceId);
  const version = source?.status === "ready" ? sourceVersion(source) : null;
  const requestKey = version ? `${version}|${table}` : null;
  const [loaded, setLoaded] = useState<{ key: string; values: string[] } | null>(null);
  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    (async () => {
      const head = await runQuery(`SELECT * FROM ${qualifiedTable(sourceId, table)} LIMIT 0`, 0);
      const cols = head.columns.map((c) => c.name);
      if (!cols.length) return [];
      const nameCol = cols.find((c) => /^#?(name|이름|title|명칭)$/i.test(c));
      const select = [quoteIdent(cols[0]), ...(nameCol ? [quoteIdent(nameCol)] : [])].join(", ");
      const r = await runQuery(`SELECT ${select} FROM ${qualifiedTable(sourceId, table)} LIMIT 10`, 10);
      // DB, CSV로 연 같은 테이블은 엑셀에서 ;로 막아 둔 Id도 뺀다.
      const off = twinInactive(sourceId, table)?.ids ?? inactiveIds(sourceId, table);
      return r.rows
        .filter((row) => !off.has(String(row[0])))
        .slice(0, 3)
        .map((row) => (nameCol && row[1] !== null && row[1] !== undefined ? `${row[0]} ${row[1]}` : String(row[0])));
    })()
      .then((values) => active && setLoaded({ key: requestKey, values }))
      .catch(() => active && setLoaded({ key: requestKey, values: [] }));
    return () => {
      active = false;
    };
  }, [requestKey, sourceId, table]);
  return loaded?.key === requestKey ? loaded.values : null;
}
