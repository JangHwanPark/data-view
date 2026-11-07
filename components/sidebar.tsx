"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { roleColor } from "@/components/map/map-parts";
import { useDomainModel } from "@/components/use-domain-model";
import { InferredMark } from "@/components/table-name";
import { setNameMode, useKoreanNames, useNameMode } from "@/components/use-korean-names";
import { displayName, firstWord, type KoreanName, type NameMode } from "@/lib/client/korean-name";
import { ROLE_LABEL, type TableRole } from "@/lib/client/domain-model";
import {
  BarChart3,
  Boxes,
  BookOpen,
  ChevronDown,
  ClipboardList,
  ChevronRight,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  House,
  GitFork,
  Loader2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SearchX,
  GitCompareArrows,
  Sheet,
  TableProperties,
} from "lucide-react";
import { sourceVersion, useWorkspace, type WorkspaceSource } from "@/components/workspace-provider";
import { loadRowCounts, tableKey } from "@/lib/client/schema";

const NAV = [
  { href: "/", label: "처음", icon: House },
  { href: "/files", label: "불러온 파일", icon: FolderOpen },
  { href: "/map", label: "시스템 지도", icon: Network },
  { href: "/docs", label: "기획서", icon: BookOpen },
  { href: "/search", label: "ID·값 찾기", icon: Search },
  { href: "/check/missing", label: "없는 ID 찾기", icon: SearchX },
  { href: "/compare", label: "패치 전후 비교", icon: GitCompareArrows },
  { href: "/relations", label: "참조 관계 목록", icon: GitFork },
  { href: "/join", label: "여러 테이블 붙여 보기", icon: TableProperties },
  { href: "/charts", label: "차트", icon: BarChart3 },
  { href: "/tc", label: "TC 시트", icon: ClipboardList },
  { href: "/vectors", label: "벡터 DB", icon: Boxes },
];

// 접힘 상태는 브라우저에 기억한다. 서버 렌더링 때는 펼친 상태로 그린다.
const COLLAPSED_KEY = "data-view:sidebar-collapsed";
const listeners = new Set<() => void>();

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 접힌다.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 테이블 목록 묶는 방식(25단계, 3-12). 파일별 또는 영어 이름 첫 단어별(Reward로 시작하는 테이블끼리).
const GROUP_KEY = "data-view:sidebar-group";
type GroupBy = "file" | "word";
function readGroupBy(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === "word" ? "word" : "file";
  } catch {
    return "file";
  }
}
function writeGroupBy(value: GroupBy) {
  try {
    localStorage.setItem(GROUP_KEY, value);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 바뀐다.
  }
  listeners.forEach((l) => l());
}

export function Sidebar() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  if (collapsed) {
    return (
      <aside className="sticky top-0 flex h-screen w-11 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => writeCollapsed(false)}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="사이드바 펼치기"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </button>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Icon className="size-4" aria-hidden />
          </Link>
        ))}
      </aside>
    );
  }

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-white text-[13px] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-10 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <Database className="size-4" aria-hidden />
        <Link href="/" className="flex-1 font-semibold">
          data-view
        </Link>
        <button
          type="button"
          onClick={() => writeCollapsed(true)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="사이드바 접기"
        >
          <PanelLeftClose className="size-4" aria-hidden />
        </button>
      </div>
      <SidebarNav />
      <TableTree />
    </aside>
  );
}

function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px border-b border-zinc-200 p-1.5 dark:border-zinc-800">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded px-2 py-1 ${
              active
                ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// 벡터 DB(33단계)에서 payload를 표로 불러온 것은 qdrant_로 시작하는 CSV라 따로 묶는다.
const isVector = (s: WorkspaceSource) => s.meta.kind === "csv" && s.meta.name.startsWith("qdrant_");
const GROUPS = [
  { label: "파일", match: (s: WorkspaceSource) => (s.meta.kind === "excel" || s.meta.kind === "csv") && !isVector(s) },
  { label: "개발 DB", match: (s: WorkspaceSource) => s.meta.kind === "mysql" },
  { label: "벡터 DB", match: isVector },
];

// 지금 보고 있는 테이블. 경로가 /sources/[id]/tables/[table] 일 때만 있다.
function activeTable(pathname: string) {
  const m = pathname.match(/^\/sources\/([^/]+)(?:\/tables\/([^/]+))?/);
  if (!m) return null;
  return { sourceId: m[1], table: m[2] ? decodeURIComponent(m[2]) : null };
}

function TableTree() {
  const { sources, relations, docs, initialized } = useWorkspace();
  const pathname = usePathname();
  const active = activeTable(pathname);
  const activeDocId = pathname.match(/^\/docs\/([^/]+)/)?.[1];
  const [filter, setFilter] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const names = useKoreanNames();
  const mode = useNameMode();
  const groupBy = useSyncExternalStore(subscribe, readGroupBy, () => "file" as GroupBy);

  const ready = sources.filter((s) => s.status === "ready");
  const schemaVersion = ready.map(sourceVersion).join("|");

  useEffect(() => {
    if (!schemaVersion) return;
    let active = true;
    loadRowCounts()
      .then((map) => active && setCounts(map))
      .catch(() => {
        // 행 수는 보조 정보라 못 읽어도 트리는 보여준다.
      });
    return () => {
      active = false;
    };
  }, [schemaVersion]);

  // 테이블마다 걸린 연결 수(설계 4.13 G10). 도메인 모델을 다 계산했으면 저장한 관계와 자동 연결을 합쳐 세고 역할도 보여준다.
  // 계산 전에는 저장한 관계만 센다.
  const { model } = useDomainModel();
  const relationCount = new Map<string, number>();
  const roles = new Map<string, TableRole>();
  if (model) {
    for (const t of model.tables.values()) {
      relationCount.set(t.key, new Set([...t.in, ...t.out].map((l) => l.key)).size);
      roles.set(t.key, t.role);
    }
  } else {
    for (const { from, to } of relations) {
      for (const end of [from, to]) {
        const key = tableKey(end.sourceId, end.table);
        relationCount.set(key, (relationCount.get(key) ?? 0) + 1);
      }
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = sources
    .map((s) => {
      const nameHit = s.meta.name.toLowerCase().includes(q);
      // 한글 이름으로도 찾는다(「보상」으로 RewardDaily, RewardWeekly).
      const tables = !q || nameHit ? s.tables : s.tables.filter((t) => t.toLowerCase().includes(q) || !!names.get(tableKey(s.meta.id, t))?.text.toLowerCase().includes(q));
      return { source: s, tables };
    })
    .filter(({ source, tables }) => !q || tables.length > 0 || source.meta.name.toLowerCase().includes(q));
  const tableTotal = sources.reduce((sum, s) => sum + s.tables.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 p-2">
        <p className="px-1 text-xs text-zinc-500">테이블 {tableTotal.toLocaleString()}개</p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="시트, 파일, 한글 이름으로 찾기"
          aria-label="테이블 거르기"
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-zinc-500">
          <Segmented
            label="묶기"
            value={groupBy}
            options={[
              ["file", "파일"],
              ["word", "앞 단어"],
            ]}
            onChange={(v) => writeGroupBy(v as GroupBy)}
          />
          <Segmented
            label="이름"
            value={mode}
            options={[
              ["en", "영어"],
              ["ko", "한글"],
              ["both", "한글 영어"],
            ]}
            onChange={(v) => setNameMode(v as NameMode)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {!initialized ? (
          <p className="px-2 text-xs text-zinc-500">불러오는 중...</p>
        ) : sources.length === 0 && docs.length === 0 ? (
          <p className="px-2 text-xs text-zinc-500">열어 둔 파일이 없습니다.</p>
        ) : (
          <>
            {docs.length > 0 && (
              <div className="pb-1">
                <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-zinc-400">기획서</p>
                {docs
                  .filter((d) => !q || d.meta.name.toLowerCase().includes(q))
                  .map((d) => (
                    <Link
                      key={d.meta.id}
                      href={`/docs/${d.meta.id}`}
                      title={d.meta.name}
                      className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${
                        d.meta.id === activeDocId
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <BookOpen className="size-3.5 shrink-0 opacity-60" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{d.meta.name}</span>
                      {d.status === "loading" && <Loader2 className="size-3 shrink-0 animate-spin" aria-label="불러오는 중" />}
                    </Link>
                  ))}
              </div>
            )}
            {visible.length === 0 && <p className="px-2 text-xs text-zinc-500">맞는 테이블이 없습니다.</p>}
            {groupBy === "word" && visible.length > 0 && (
              <WordGroups
                items={visible.flatMap(({ source, tables }) => (source.status === "ready" ? tables.map((table) => ({ source, table })) : []))}
                active={active}
                counts={counts}
                relationCount={relationCount}
                roles={roles}
                names={names}
                mode={mode}
              />
            )}
            {/* 소스 종류별로 묶는다. 소스가 없는 묶음은 숨긴다. 벡터 DB 묶음은 해당 단계에서 같은 모양으로 붙인다. */}
            {groupBy === "file" && GROUPS.map((group) => {
              const members = visible.filter(({ source }) => group.match(source));
              if (members.length === 0) return null;
              return (
                <div key={group.label} className="pb-1">
                  <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-zinc-400">{group.label}</p>
                  {members.map(({ source, tables }) => {
                    const containsActive = active?.sourceId === source.meta.id;
                    const open = q ? true : (toggled[source.meta.id] ?? containsActive);
                    return (
                      <SourceNode
                        key={source.meta.id}
                        source={source}
                        tables={tables}
                        open={open}
                        onToggle={() => setToggled((prev) => ({ ...prev, [source.meta.id]: !open }))}
                        activeTable={containsActive ? active?.table ?? null : null}
                        sourceActive={containsActive && !active?.table}
                        counts={counts}
                        relationCount={relationCount}
                        roles={roles}
                        names={names}
                        mode={mode}
                      />
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

interface SourceNodeProps {
  source: WorkspaceSource;
  tables: string[];
  open: boolean;
  onToggle: () => void;
  activeTable: string | null;
  sourceActive: boolean;
  counts: Map<string, number>;
  relationCount: Map<string, number>;
  roles: Map<string, TableRole>;
  names: Map<string, KoreanName>;
  mode: NameMode;
}

function SourceNode({ source, tables, open, onToggle, activeTable, sourceActive, counts, relationCount, roles, names, mode }: SourceNodeProps) {
  const { meta, status } = source;
  const Icon = meta.kind === "mysql" ? Database : meta.kind === "excel" ? FileSpreadsheet : FileText;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
          sourceActive ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          aria-label={open ? `${meta.name} 접기` : `${meta.name} 펼치기`}
          aria-expanded={open}
        >
          <Chevron className="size-3.5" aria-hidden />
        </button>
        <Icon className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
        <Link href={`/sources/${meta.id}`} className="min-w-0 flex-1 truncate" title={meta.name}>
          {meta.name}
        </Link>
        {status === "loading" && <Loader2 className="size-3 shrink-0 animate-spin text-zinc-400" aria-label="불러오는 중" />}
        {status === "error" && <span className="shrink-0 text-[11px] text-red-600">오류</span>}
        {status === "ready" && <span className="shrink-0 text-[11px] text-zinc-400">{source.tables.length}</span>}
      </div>
      {open && status === "ready" && (
        <ul className="ml-4 border-l border-zinc-200 pl-1 dark:border-zinc-800">
          {tables.map((table) => (
            <TableItem
              key={table}
              sourceId={meta.id}
              table={table}
              active={table === activeTable}
              counts={counts}
              relationCount={relationCount}
              roles={roles}
              names={names}
              mode={mode}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface TableItemProps {
  sourceId: string;
  table: string;
  active: boolean;
  counts: Map<string, number>;
  relationCount: Map<string, number>;
  roles: Map<string, TableRole>;
  names: Map<string, KoreanName>;
  mode: NameMode;
  note?: string; // 앞 단어로 묶었을 때 파일 이름
}

function TableItem({ sourceId, table, active: isActive, counts, relationCount, roles, names, mode, note }: TableItemProps) {
  const key = tableKey(sourceId, table);
  const rows = counts.get(key);
  const rels = relationCount.get(key);
  const role = roles.get(key);
  const name = names.get(key);
  return (
    <li>
      <Link
        href={`/sources/${sourceId}/tables/${encodeURIComponent(table)}`}
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${
          isActive ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
        }`}
        title={[name ? `${name.text}${name.inferred ? "(추론)" : ""}` : null, table, role ? ROLE_LABEL[role] : null, note].filter(Boolean).join(" · ")}
      >
        {role ? (
          <span className="mx-0.5 size-2 shrink-0 rounded-sm" style={{ background: roleColor(role) }} aria-label={ROLE_LABEL[role]} />
        ) : (
          <Sheet className={`size-3 shrink-0 ${isActive ? "" : "text-zinc-400"}`} aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 items-center">
          <span className="truncate">{displayName(table, name, mode)}</span>
          {name && mode !== "en" && <InferredMark name={name} />}
        </span>
        {rels ? (
          <span
            className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] ${isActive ? "" : "text-blue-600 dark:text-blue-400"}`}
            title={`참조 관계로 이어진 테이블 ${rels}개 (참조 대상과 참조하는 곳)`}
          >
            <GitFork className="size-3" aria-hidden />
            {rels}
          </span>
        ) : null}
        {rows !== undefined && (
          <span className={`w-12 shrink-0 text-right text-[11px] tabular-nums ${isActive ? "" : "text-zinc-400"}`}>{rows.toLocaleString()}</span>
        )}
      </Link>
    </li>
  );
}

// 영어 이름 첫 단어로 묶은 목록(3-12). Reward로 시작하는 RewardDaily, RewardWeekly, RewardEvent가 한 묶음이다.
// 테이블이 하나뿐인 묶음은 「그 밖」에 모은다.
function WordGroups({
  items,
  active,
  ...rest
}: {
  items: { source: WorkspaceSource; table: string }[];
  active: { sourceId: string; table: string | null } | null;
  counts: Map<string, number>;
  relationCount: Map<string, number>;
  roles: Map<string, TableRole>;
  names: Map<string, KoreanName>;
  mode: NameMode;
}) {
  const byWord = new Map<string, typeof items>();
  for (const item of items) {
    const w = firstWord(item.table);
    const k = w.toLowerCase();
    byWord.set(k, [...(byWord.get(k) ?? []), item]);
  }
  const groups = [...byWord.values()].filter((g) => g.length > 1).sort((a, b) => firstWord(a[0].table).localeCompare(firstWord(b[0].table)));
  const others = [...byWord.values()].filter((g) => g.length === 1).flat().sort((a, b) => a.table.localeCompare(b.table));
  const section = (label: string, list: typeof items) => (
    <div key={label} className="pb-1">
      <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-zinc-400">
        {label} <span className="font-normal">{list.length}</span>
      </p>
      <ul>
        {list.map(({ source, table }) => (
          <TableItem
            key={`${source.meta.id}/${table}`}
            sourceId={source.meta.id}
            table={table}
            active={active?.sourceId === source.meta.id && active.table === table}
            note={source.meta.name}
            {...rest}
          />
        ))}
      </ul>
    </div>
  );
  return (
    <>
      {groups.map((g) => section(firstWord(g[0].table), g))}
      {others.length > 0 && section("그 밖", others)}
    </>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={`px-1.5 py-px ${value === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {text}
          </button>
        ))}
      </span>
    </span>
  );
}
