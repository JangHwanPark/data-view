"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { useDomainModel } from "@/components/use-domain-model";
import { columnDetail, profileColumns, type ColumnDetail, type ColumnProfile } from "@/lib/client/column-profile";
import type { LinkEnd } from "@/lib/client/domain-model";
import { columnDescription } from "@/lib/client/file-import";
import type { QueryColumn } from "@/lib/query-result";

// 테이블 열 정보 줄(설계 6.2). 데이터 표의 머리글 아래에 열마다 종류, 빈 칸, 값 종류, ID 열 여부,
// 이 열이 쓰는 테이블(→)과 이 열을 쓰는 곳(←)을 적는다. 머리글에 마우스를 올리면 자주 나오는 값과 범위를 보여준다.

const TYPE_LABEL: Record<QueryColumn["type"], string> = { string: "글자", number: "숫자", boolean: "참/거짓", date: "날짜", unknown: "기타" };
const tableOf = (key: string) => key.slice(key.indexOf("/") + 1);

export function useColumnProfiles(sourceId: string, table: string, columns: string[], ready: boolean) {
  const { sources } = useWorkspace();
  const source = sources.find((s) => s.meta.id === sourceId);
  const version = source ? sourceVersion(source) : "";
  const key = ready && columns.length ? JSON.stringify([version, sourceId, table, columns]) : null;
  const [loaded, setLoaded] = useState<{ key: string; map: Map<string, ColumnProfile> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    profileColumns(sourceId, table, columns, version)
      .then((map) => active && setLoaded({ key, map }))
      .catch(() => {});
    return () => {
      active = false;
    };
    // columns와 version은 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { profiles: loaded?.key === key ? loaded.map : null, version };
}

interface Props {
  sourceId: string;
  table: string;
  column: QueryColumn;
  profile?: ColumnProfile;
  version: string;
}

// 머리글 안의 열 정보. 마우스를 올리면 자세한 내용을 띄운다.
export function ColumnHeaderInfo({ sourceId, table, column, profile, version }: Props) {
  const { model } = useDomainModel();
  const info = model?.tables.get(`${sourceId}/${table}`);
  const uses = (info?.out ?? []).filter((l) => l.column === column.name);
  const usedBy = (info?.in ?? []).filter((l) => l.column === column.name);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = profile && profile.rows ? 1 - profile.filled / profile.rows : 0;
  const usesTables = [...new Set(uses.map((l) => tableOf(l.key)))];

  return (
    <div
      className="cursor-help"
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setHover(rect), 300);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setHover(null);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 text-xs font-normal text-zinc-500">
        <span>{TYPE_LABEL[column.type]}</span>
        {profile?.isId && (
          <span className="inline-flex items-center gap-0.5 text-zinc-700 dark:text-zinc-300" title="값이 모두 다르고 빈 칸이 없어 ID 열로 볼 수 있습니다">
            <KeyRound className="size-3" aria-hidden />
            ID 열
          </span>
        )}
        {/* ID 열인데 같은 값이 있으면(98% 기준이라 몇 개는 섞일 수 있다) 몇 개 겹치는지 알린다. */}
        {profile?.isId && profile.filled > profile.distinct && (
          <span className="text-red-700 dark:text-red-400" title="같은 ID가 두 번 이상 나온 행 수. 없는 ID 찾기의 중복 ID에서 볼 수 있습니다">
            중복 {(profile.filled - profile.distinct).toLocaleString()}
          </span>
        )}
        {profile && empty > 0.0005 && (
          <span className={empty >= 0.5 ? "text-amber-700 dark:text-amber-400" : ""}>빈 칸 {formatPercent(empty)}</span>
        )}
        {profile && !profile.isId && <span>값 {profile.distinct.toLocaleString()}종</span>}
      </div>
      {(usesTables.length > 0 || usedBy.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-normal">
          {usesTables.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400" title="이 열의 값이 가리키는 테이블">
              <ArrowRight className="size-3" aria-hidden />
              {usesTables.length > 2 ? `${usesTables.slice(0, 2).join(", ")} 외 ${usesTables.length - 2}` : usesTables.join(", ")}
            </span>
          )}
          {usedBy.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400" title="이 열의 값을 쓰는 곳">
              <ArrowLeft className="size-3" aria-hidden />
              {new Set(usedBy.map((l) => l.key)).size}곳에서 씀
            </span>
          )}
        </div>
      )}
      {hover && <DetailPopover rect={hover} sourceId={sourceId} table={table} column={column} profile={profile} version={version} uses={uses} usedBy={usedBy} />}
    </div>
  );
}

function formatPercent(v: number) {
  if (v > 0 && v < 0.01) return "1% 미만";
  return `${Math.round(v * 100)}%`;
}

interface PopoverProps extends Omit<Props, "profile"> {
  rect: DOMRect;
  profile?: ColumnProfile;
  uses: LinkEnd[];
  usedBy: LinkEnd[];
}

function DetailPopover({ rect, sourceId, table, column, profile, version, uses, usedBy }: PopoverProps) {
  const [detail, setDetail] = useState<ColumnDetail | "error" | null>(null);
  useEffect(() => {
    let active = true;
    columnDetail(sourceId, table, column.name, version)
      .then((d) => active && setDetail(d))
      .catch(() => active && setDetail("error"));
    return () => {
      active = false;
    };
  }, [sourceId, table, column.name, version]);

  const desc = columnDescription(sourceId, table, column.name);
  const left = Math.max(8, Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 336));
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-80 rounded-md border border-zinc-200 bg-white p-3 text-xs font-normal text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      style={{ left, top: rect.bottom + 6 }}
    >
      <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{column.name}</p>
      {desc && (
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">
          <span className="text-zinc-500">{desc.from === "design" ? "설명(#Design)" : "정의(#Definition)"}: </span>
          {desc.text}
        </p>
      )}
      {profile && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-zinc-500">종류</dt>
          <dd>{TYPE_LABEL[column.type]}</dd>
          <dt className="text-zinc-500">채워진 칸</dt>
          <dd>
            {profile.rows.toLocaleString()}행 중 {profile.filled.toLocaleString()}행
            {profile.rows > profile.filled && ` (빈 칸 ${(profile.rows - profile.filled).toLocaleString()})`}
          </dd>
          <dt className="text-zinc-500">값 종류</dt>
          <dd>
            {profile.distinct.toLocaleString()}종
            {profile.isId
              ? profile.filled > profile.distinct
                ? ` · ID 열이지만 같은 값이 ${(profile.filled - profile.distinct).toLocaleString()}행 겹침`
                : " · 값이 모두 달라 ID 열로 볼 수 있음"
              : ""}
          </dd>
          {detail && detail !== "error" && detail.min !== null && (
            <>
              <dt className="text-zinc-500">{detail.numeric ? "범위" : "처음과 끝"}</dt>
              <dd className="break-all">
                {detail.min} ~ {detail.max}
              </dd>
            </>
          )}
        </dl>
      )}
      {detail === null ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          자주 나오는 값을 세는 중
        </p>
      ) : detail !== "error" && detail.top.length > 0 && !profile?.isId ? (
        <div className="mt-1.5">
          <p className="text-zinc-500">자주 나오는 값</p>
          <ul>
            {detail.top.map((t) => (
              <li key={t.value} className="flex gap-2 tabular-nums">
                <span className="min-w-0 flex-1 truncate">{t.value}</span>
                <span className="text-zinc-500">{t.count.toLocaleString()}행</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {uses.length > 0 && (
        <div className="mt-1.5">
          <p className="text-zinc-500">이 열이 쓰는 테이블</p>
          <ul>
            {uses.map((l, i) => (
              <li key={i}>
                → {tableOf(l.key)}.{l.otherColumn}
                {l.when ? ` (${l.when.column}이 ${l.when.value}일 때)` : ""}
                {l.separator ? ` (${l.separator}로 나눔)` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {usedBy.length > 0 && (
        <div className="mt-1.5">
          <p className="text-zinc-500">이 열의 값을 쓰는 곳</p>
          <ul>
            {usedBy.slice(0, 10).map((l, i) => (
              <li key={i}>
                ← {tableOf(l.key)}.{l.otherColumn}
              </li>
            ))}
            {usedBy.length > 10 && <li className="text-zinc-400">외 {usedBy.length - 10}곳</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
