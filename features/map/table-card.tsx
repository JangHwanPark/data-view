"use client";

import { TableName } from "@/core/ui/table-name";
import Link from "next/link";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { RoleBadge, roleColor, tablePath } from "@/core/ui/map-parts";
import { setDomainOverride } from "@/core/ui/use-domain-model";
import { splitKey, type DomainModel, type LinkEnd, type TableInfo } from "@/core/domain-model";

const ROW = 20; // 목록 한 줄 높이(px)
const GAP = 36; // 선을 그리는 칸의 너비(px)
const MAX_ITEMS = 8;

interface Props {
  info: TableInfo;
  model: DomainModel;
  rows?: number;
  domains: string[]; // 도메인 바꾸기 입력의 후보
}

// 테이블 하나의 연결 그림(설계 4.12 D7). 왼쪽은 이 테이블을 가리키는 테이블, 오른쪽은 이 테이블이 가리키는 테이블이다.
// 카드마다 React Flow를 띄우면 테이블이 많을 때 무거워서, 목록은 HTML로 두고 선만 SVG로 그린다.
export function TableCard({ info, model, rows, domains }: Props) {
  const left = info.in.slice(0, MAX_ITEMS);
  const right = info.out.slice(0, MAX_ITEMS);
  const restLeft = info.in.length - left.length;
  const restRight = info.out.length - right.length;
  const leftRows = left.length + (restLeft > 0 ? 1 : 0);
  const rightRows = right.length + (restRight > 0 ? 1 : 0);
  const height = Math.max(leftRows, rightRows, 1) * ROW;
  const parent = info.parent ? model.tables.get(info.parent) : null;

  return (
    <article
      id={`t-${info.key}`}
      className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link href={tablePath(info.key)} className="font-semibold hover:underline">
          <TableName sourceId={info.sourceId} table={info.table} />
        </Link>
        <RoleBadge role={info.role} />
        {parent && (
          <span className="text-zinc-500">
            위 테이블{" "}
            <Link href={tablePath(parent.key)} className="text-blue-700 hover:underline dark:text-blue-400">
              {parent.table}
            </Link>
          </span>
        )}
        {rows !== undefined && <span className="tabular-nums text-zinc-400">{rows.toLocaleString()}행</span>}
        <DomainEditor info={info} domains={domains} />
      </header>

      {info.role === "isolated" ? (
        <p className="text-zinc-400">이어진 테이블을 찾지 못했습니다.</p>
      ) : (
        <div className="grid items-center" style={{ gridTemplateColumns: `minmax(0,1fr) ${GAP}px auto ${GAP}px minmax(0,1fr)` }}>
          <ul className="flex flex-col items-end justify-center" style={{ height }}>
            {left.map((l) => (
              <End key={`${l.relationId}|${l.column}|${l.otherColumn}`} end={l} model={model} domain={info.domain} side="left" />
            ))}
            {restLeft > 0 && <li className="flex h-5 items-center text-zinc-400">외 {restLeft}개</li>}
          </ul>
          <Lines count={left.length} rows={leftRows} height={height} side="left" />
          <div
            className="max-w-40 truncate rounded border-2 bg-white px-2 py-1 text-center font-medium dark:bg-zinc-900"
            style={{ borderColor: roleColor(info.role) }}
            title={info.table}
          >
            {info.table}
          </div>
          <Lines count={right.length} rows={rightRows} height={height} side="right" />
          <ul className="flex flex-col items-start justify-center" style={{ height }}>
            {right.map((l) => (
              <End key={`${l.relationId}|${l.column}|${l.otherColumn}`} end={l} model={model} domain={info.domain} side="right" />
            ))}
            {restRight > 0 && <li className="flex h-5 items-center text-zinc-400">외 {restRight}개</li>}
          </ul>
        </div>
      )}
    </article>
  );
}

// 상대 테이블 한 줄. 다른 도메인의 테이블이면 도메인 이름을 앞에 붙인다.
function End({ end, model, domain, side }: { end: LinkEnd; model: DomainModel; domain: string; side: "left" | "right" }) {
  const other = model.tables.get(end.key);
  const { table } = splitKey(end.key);
  const otherDomain = other && other.domain !== domain ? other.domain : null;
  const title = side === "left" ? `${table}.${end.otherColumn} → ${end.column}` : `${end.column} → ${table}.${end.otherColumn}`;
  return (
    <li className="flex h-5 max-w-full items-center gap-1" title={title}>
      {side === "right" && <span className="shrink-0 text-zinc-400">{end.column}</span>}
      {other && <span className="size-2 shrink-0 rounded-sm" style={{ background: roleColor(other.role) }} aria-hidden />}
      <Link href={tablePath(end.key)} className="min-w-0 truncate hover:underline">
        {otherDomain && <span className="text-zinc-400">{otherDomain} · </span>}
        {table}
      </Link>
      {side === "left" && <span className="shrink-0 text-zinc-400">.{end.otherColumn}</span>}
    </li>
  );
}

// 목록의 줄마다 가운데 상자로 모이는 선. 오른쪽은 가리키는 방향이라 화살표를 붙인다.
function Lines({ count, rows, height, side }: { count: number; rows: number; height: number; side: "left" | "right" }) {
  const mid = height / 2;
  const top = (height - rows * ROW) / 2;
  return (
    <svg width={GAP} height={height} className="overflow-visible text-zinc-300 dark:text-zinc-600" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const y = top + i * ROW + ROW / 2;
        const [x1, y1, x2, y2] = side === "left" ? [0, y, GAP, mid] : [0, mid, GAP - 4, y];
        return <path key={i} d={`M${x1},${y1} C${GAP / 2},${y1} ${GAP / 2},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" strokeWidth={1.5} />;
      })}
      {side === "right" &&
        Array.from({ length: count }, (_, i) => {
          const y = top + i * ROW + ROW / 2;
          return <path key={`a${i}`} d={`M${GAP - 5},${y - 3} L${GAP},${y} L${GAP - 5},${y + 3}`} fill="none" stroke="currentColor" strokeWidth={1.5} />;
        })}
    </svg>
  );
}

// 도메인 바꾸기(D3). 비우고 저장하면 자동으로 정한 도메인으로 돌아간다.
function DomainEditor({ info, domains }: { info: TableInfo; domains: string[] }) {
  const [draft, setDraft] = useState<string | null>(null);
  const changed = info.domain !== info.autoDomain;
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(info.domain)}
        className="ml-auto inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title={changed ? `직접 고른 시스템입니다. 앱이 정한 시스템은 ${info.autoDomain}입니다.` : "이 테이블을 다른 시스템으로 옮기기"}
      >
        <Pencil className="size-3" aria-hidden />
        {changed ? "시스템 직접 지정함" : "시스템 바꾸기"}
      </button>
    );
  }
  const listId = `domains-${info.key}`;
  return (
    <form
      className="ml-auto flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const value = draft.trim();
        void setDomainOverride(info.key, value === info.autoDomain ? null : value).then(() => setDraft(null));
      }}
    >
      <input
        autoFocus
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`${info.table}의 시스템`}
        placeholder={info.autoDomain}
        className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <datalist id={listId}>
        {domains.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <button type="submit" className="rounded bg-zinc-900 px-1.5 py-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
        저장
      </button>
      <button type="button" onClick={() => setDraft(null)} className="rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        취소
      </button>
    </form>
  );
}
