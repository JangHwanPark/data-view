"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Loader2, Network, Save } from "lucide-react";
import { sourceTableLabel } from "@/components/relations/relation-parts";
import { TableDocNotes } from "@/components/table-doc-notes";
import { TableGraph } from "@/components/table-graph";
import { useWorkspace } from "@/components/workspace-provider";
import { isAutoRelation } from "@/lib/client/auto-links";
import type { RowFocus } from "@/lib/client/doc-links";
import { newRelationId, type Relation } from "@/lib/client/relations";
import { graphHref } from "@/lib/client/table-view";

interface Props {
  focus: RowFocus | null; // 기획서에서 연 행
  sourceId: string;
  table: string;
  columns: string[];
  relations: Relation[]; // 저장한 관계와 자동으로 찾은 연결을 합친 것
  reasons: Map<string, string>; // 자동 연결의 근거
  ready: boolean; // 자동 연결을 다 찾았는지
}

// 테이블 화면 위의 연결 영역. 이어진 테이블 그림과 목록, 이 테이블을 다루는 기획서를 보여준다.
// 실무 테이블은 이미 이어져 있으므로, 관계를 저장하지 않아도 자동으로 찾은 연결을 바로 보여준다.
export function TableLinks({ focus, sourceId, table, columns, relations, reasons, ready }: Props) {
  const { sources } = useWorkspace();
  const label = (id: string, t: string) => sourceTableLabel(sources.find((s) => s.meta.id === id), t);
  const here = (r: { sourceId: string; table: string }) => r.sourceId === sourceId && r.table === table;

  const outgoing = relations.filter((r) => here(r.from));
  const incoming = relations.filter((r) => here(r.to));
  // 데이터 보기에서는 작은 연결 그림을 접어 둔다(설계 4.13 G11). 관계는 관계도 보기에서 크게 본다.
  const [showGraph, setShowGraph] = useState(false);
  const Chevron = showGraph ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
      {outgoing.length + incoming.length > 0 && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setShowGraph((v) => !v)} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-expanded={showGraph}>
            <Chevron className="size-3.5" aria-hidden />
            이어진 테이블 그림 {showGraph ? "접기" : "펼치기"}
          </button>
          <Link href={graphHref(`${sourceId}/${table}`)} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
            <Network className="size-3.5" aria-hidden />
            관계도로 보기
          </Link>
        </div>
      )}
      {showGraph && outgoing.length + incoming.length > 0 && <TableGraph sourceId={sourceId} table={table} />}
      {/* 그림 바로 아래에 이 테이블이 어떤 테이블인지 기획서에서 찾아 보여준다. */}
      <TableDocNotes sourceId={sourceId} table={table} columns={columns} focus={focus} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex w-20 shrink-0 items-center gap-1 text-zinc-500">
          <ArrowRight className="size-3.5" aria-hidden />
          가리키는
        </span>
        {outgoing.length === 0 && <span className="text-zinc-400">{ready ? "없음" : "찾는 중"}</span>}
        {outgoing.map((r) => (
          <RelationChip
            key={r.id}
            reason={reasons.get(r.id)}
            r={r}
            other={r.to}
            text={
              <>
                <span className="text-zinc-500">{r.from.column} →</span>
                {label(r.to.sourceId, r.to.table)}
              </>
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex w-20 shrink-0 items-center gap-1 text-zinc-500">
          <ArrowLeft className="size-3.5" aria-hidden />
          가리켜지는
        </span>
        {incoming.length === 0 && <span className="text-zinc-400">{ready ? "없음" : "찾는 중"}</span>}
        {incoming.map((r) => (
          <RelationChip
            key={r.id}
            reason={reasons.get(r.id)}
            r={r}
            other={r.from}
            text={
              <>
                {label(r.from.sourceId, r.from.table)}
                <span className="text-zinc-500">.{r.from.column} →</span>
              </>
            }
          />
        ))}
        {!ready && <Loader2 className="size-3 animate-spin text-zinc-400" aria-label="이어진 테이블을 찾는 중" />}
      </div>
    </div>
  );
}

const chip =
  "inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500";

interface ChipProps {
  r: Relation;
  other: { sourceId: string; table: string };
  text: React.ReactNode;
  reason?: string;
}

// 저장한 관계는 실선, 자동으로 찾은 연결은 점선 테두리. 자동 연결은 옆 버튼으로 관계로 저장한다.
function RelationChip({ r, other, text, reason }: ChipProps) {
  const { addRelations } = useWorkspace();
  const auto = isAutoRelation(r);
  return (
    <span className="inline-flex items-center">
      <Link
        href={`/sources/${other.sourceId}/tables/${encodeURIComponent(other.table)}`}
        className={`${chip} ${auto ? "border-dashed" : ""}`}
        title={auto ? reason : "저장한 관계"}
      >
        {text}
        {auto && <span className="text-[10px] text-zinc-400">자동</span>}
      </Link>
      {auto && (
        <button
          type="button"
          onClick={() => void addRelations([{ id: newRelationId(), from: r.from, to: r.to }])}
          className="ml-0.5 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
          title="관계로 저장"
          aria-label="관계로 저장"
        >
          <Save className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}