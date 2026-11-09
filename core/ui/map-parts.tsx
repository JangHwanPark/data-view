"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ROLE_HELP, ROLE_LABEL, ROLE_ORDER, type TableRole } from "@/core/domain-model";
import { graphHref } from "@/core/table-view";

export const roleColor = (role: TableRole) => `var(--role-${role})`;

// 역할은 색 점과 글자를 같이 보여준다. 색만으로 구분하지 않는다.
export function RoleBadge({ role, title }: { role: TableRole; title?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400" title={title ?? ROLE_HELP[role]}>
      <span className="size-2 rounded-sm" style={{ background: roleColor(role) }} aria-hidden />
      {ROLE_LABEL[role]}
    </span>
  );
}

export function RoleLegend({ counts }: { counts?: Map<TableRole, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ROLE_ORDER.map((role) => (
        <span key={role} className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400" title={ROLE_HELP[role]}>
          <span className="size-2.5 rounded-sm" style={{ background: roleColor(role) }} aria-hidden />
          {ROLE_LABEL[role]}
          {counts && <span className="tabular-nums text-zinc-400">{counts.get(role) ?? 0}</span>}
        </span>
      ))}
    </div>
  );
}

const TABS = [
  { key: "domains", href: "/map", label: "시스템 지도" },
  { key: "tables", href: "/map/tables", label: "테이블별 참조 관계" },
] as const;

export function MapTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-1.5 ${
            tab.key === active ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function ScanProgress({ progress }: { progress: { done: number; total: number } }) {
  return (
    <p className="inline-flex items-center gap-2 text-zinc-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {progress.total
        ? `테이블끼리 어떻게 이어지는지 찾는 중입니다 (${progress.done}/${progress.total}). 처음 한 번만 걸리고, 파일이 바뀌기 전까지 다시 찾지 않습니다.`
        : "데이터를 읽는 중입니다."}
    </p>
  );
}

// 도메인 지도와 테이블별 연결에서 테이블을 누르면 그 테이블의 관계도를 연다(설계 4.13).
export const tablePath = (key: string) => graphHref(key);
