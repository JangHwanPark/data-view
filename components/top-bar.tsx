"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChevronRight, Search } from "lucide-react";
import { SourceAddMenu } from "@/components/source-add-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWorkspace } from "@/components/workspace-provider";

interface Crumb {
  label: string;
  href?: string;
}

// 본문 위 막대. 사이드바 머리와 높이를 맞춰 화면 위쪽 선이 한 줄로 이어지게 한다.
export function TopBar() {
  const { sources, relations, docs } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const crumbs = breadcrumb(
    pathname,
    (id) => sources.find((s) => s.meta.id === id)?.meta.name,
    (id) => docs.find((d) => d.meta.id === id)?.meta.name,
  );
  const tableTotal = sources.reduce((sum, s) => sum + s.tables.length, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-10 shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-5 dark:border-zinc-800 dark:bg-zinc-900">
      <nav aria-label="현재 위치" className="flex min-w-0 flex-1 items-center gap-1 text-zinc-500">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden />}
              {c.href && !last ? (
                <Link href={c.href} className="truncate hover:text-zinc-900 dark:hover:text-zinc-100">
                  {c.label}
                </Link>
              ) : (
                <span className={`truncate ${last ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}`}>{c.label}</span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="hidden shrink-0 items-center gap-3 text-xs text-zinc-500 lg:flex">
        <span>
          파일 <span className="tabular-nums text-zinc-900 dark:text-zinc-100">{sources.length}</span>
        </span>
        <span>
          테이블 <span className="tabular-nums text-zinc-900 dark:text-zinc-100">{tableTotal}</span>
        </span>
        <Link href="/relations" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          확인한 참조 관계 <span className="tabular-nums text-zinc-900 dark:text-zinc-100">{relations.length}</span>
        </Link>
      </div>

      <form onSubmit={submit} className="relative w-56 shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ID나 값으로 모든 테이블 찾기"
          aria-label="ID나 값으로 모든 테이블 찾기"
          className="w-full rounded border border-zinc-300 bg-white py-1 pr-2 pl-7 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
      </form>
      <SourceAddMenu />
      <ThemeToggle />
    </header>
  );
}

function breadcrumb(
  pathname: string,
  sourceName: (id: string) => string | undefined,
  docName: (id: string) => string | undefined,
): Crumb[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "sources" && parts[1] === "new") {
    return [{ label: "처음", href: "/" }, { label: parts[2] === "path" ? "경로에서 불러오기" : "개발 DB에서 불러오기" }];
  }
  if (parts[0] === "sources" && parts[1]) {
    const crumbs: Crumb[] = [
      { label: "불러온 파일", href: "/files" },
      { label: sourceName(parts[1]) ?? "알 수 없는 파일", href: `/sources/${parts[1]}` },
    ];
    if (parts[2] === "tables" && parts[3]) crumbs.push({ label: parts[3] });
    return crumbs;
  }
  if (parts[0] === "relations") {
    return parts[1] === "diagram"
      ? [{ label: "참조 관계 목록", href: "/relations" }, { label: "참조 관계 그림" }]
      : [{ label: "참조 관계 목록" }];
  }
  if (parts[0] === "docs") {
    return parts[1]
      ? parts[2] === "checklist"
        ? [{ label: "기획서", href: "/docs" }, { label: docName(parts[1]) ?? "알 수 없는 기획서", href: `/docs/${parts[1]}` }, { label: "테스트 항목" }]
        : [{ label: "기획서", href: "/docs" }, { label: docName(parts[1]) ?? "알 수 없는 기획서" }]
      : [{ label: "기획서" }];
  }
  if (parts[0] === "search") return [{ label: "ID·값 찾기" }];
  if (parts[0] === "join") return [{ label: "여러 테이블 붙여 보기" }];
  if (parts[0] === "tc") return [{ label: "TC 시트" }];
  if (parts[0] === "map") return parts[1] === "tables" ? [{ label: "시스템 지도", href: "/map" }, { label: "테이블별 참조 관계" }] : [{ label: "시스템 지도" }];
  if (parts[0] === "files") return [{ label: "불러온 파일" }];
  if (parts[0] === "check") return [{ label: "없는 ID 찾기" }];
  if (parts[0] === "compare") return [{ label: "패치 전후 비교" }];
  return [{ label: "처음" }];
}
