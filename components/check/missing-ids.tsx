"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { ScanProgress, tablePath } from "@/components/map/map-parts";
import { useDomainModel } from "@/components/use-domain-model";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { tableHref } from "@/lib/client/doc-links";
import type { DomainModel } from "@/lib/client/domain-model";
import { findDuplicates, findInactiveRefs, findMissing, TOP_LIMIT, type DuplicateResult, type MissingResult } from "@/lib/client/integrity";
import type { ColumnRef, FromSide } from "@/lib/client/relations";

// 없는 ID 찾기(설계 4.9 참조 무결성 검사). 앱이 찾은 연결과 확인한 연결을 모두 돌려,
// 다른 테이블에 없는 ID를 쓰는 행과 ID 열에 같은 값이 겹친 곳을 모은다.

interface CheckLink {
  id: string; // 연결 id + 쓰는 쪽 컬럼(번호 붙은 열 묶음은 열마다 따로 센다)
  relationId: string; // 연결 id. ?link=로 고를 때 쓴다
  from: FromSide;
  to: ColumnRef;
  fromKey: string;
  toKey: string;
}

interface CheckResult {
  missing: Map<string, MissingResult>; // 연결 id → 결과
  inactive: Map<string, MissingResult>; // 연결 id → 비활성 행을 참조하는 결과(29단계). 0행이면 넣지 않는다
  duplicates: { ref: ColumnRef; key: string; result: DuplicateResult }[];
}

// 다 확인한 결과는 데이터가 바뀌기 전까지 기억해, 화면을 다시 열면 바로 보여준다.
const cache = new Map<string, CheckResult>();

const split = (key: string, column: string): ColumnRef => {
  const slash = key.indexOf("/");
  return { sourceId: key.slice(0, slash), table: key.slice(slash + 1), column };
};

function collectLinks(model: DomainModel): CheckLink[] {
  const byId = new Map<string, CheckLink>();
  for (const t of model.tables.values()) {
    for (const l of t.out) {
      // 번호 붙은 열 묶음은 열마다 따로 센다. 구분자와 타입 조건은 그대로 넘긴다.
      const id = `${l.relationId}|${l.column}`;
      if (byId.has(id)) continue;
      const from: FromSide = { ...split(t.key, l.column), ...(l.separator ? { separator: l.separator } : {}), ...(l.when ? { when: l.when } : {}) };
      byId.set(id, { id, relationId: l.relationId, from, to: split(l.key, l.otherColumn), fromKey: t.key, toKey: l.key });
    }
  }
  return [...byId.values()];
}

// 걸러 보기 링크. row 쿼리가 있으면 테이블 화면은 데이터 보기로 열린다.
const rowHref = (ref: ColumnRef, value: string) => `${tableHref(ref.sourceId, ref.table, { column: ref.column, value })}&view=data`;

export function MissingIds() {
  const { sources } = useWorkspace();
  const { model, progress, error } = useDomainModel();
  const searchParams = useSearchParams();
  const focusLink = searchParams.get("link");
  const [tab, setTab] = useState<"missing" | "inactive" | "dup">("missing");
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusLink ? [focusLink] : []));

  const links = model ? collectLinks(model) : [];
  const version = sources.filter((s) => s.status === "ready").map(sourceVersion).join("|");
  const key = model ? JSON.stringify([version, links.map((l) => l.id).sort()]) : null;
  const cached = key ? cache.get(key) ?? null : null;
  const [running, setRunning] = useState<{ key: string; done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!key || cache.has(key)) return;
    let active = true;
    (async () => {
      // 대상 ID 열은 같은 테이블을 여러 연결이 쓰므로 한 번씩만 센다.
      const targets = new Map<string, ColumnRef>();
      for (const l of links) targets.set(`${l.toKey}/${l.to.column}`, l.to);
      const total = links.length * 2 + targets.size;
      let done = 0;
      const tick = () => {
        done++;
        if (active && (done % 5 === 0 || done === total)) setRunning({ key, done, total });
      };
      setRunning({ key, done: 0, total });
      const missing = new Map<string, MissingResult>();
      for (const l of links) {
        if (!active) return;
        missing.set(l.id, await findMissing(l.from, l.to).catch(() => ({ rows: 0, ids: 0, top: [] })));
        tick();
      }
      const inactive = new Map<string, MissingResult>();
      for (const l of links) {
        if (!active) return;
        const r = await findInactiveRefs(l.from, l.to).catch(() => null);
        if (r && r.rows > 0) inactive.set(l.id, r);
        tick();
      }
      const duplicates: CheckResult["duplicates"] = [];
      for (const [k, ref] of targets) {
        if (!active) return;
        const result = await findDuplicates(ref).catch(() => ({ values: 0, top: [] }));
        if (result.values > 0) duplicates.push({ ref, key: k, result });
        tick();
      }
      duplicates.sort((a, b) => b.result.values - a.result.values);
      cache.set(key, { missing, inactive, duplicates });
      if (active) setRunning(null);
    })().catch((e) => active && setFailed({ key, message: e instanceof Error ? e.message : String(e) }));
    return () => {
      active = false;
    };
    // links는 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ?link=로 들어오면 그 연결로 스크롤한다.
  useEffect(() => {
    if (!cached || !focusLink) return;
    document.querySelector(`[data-link="${CSS.escape(focusLink)}"]`)?.scrollIntoView({ block: "center" });
  }, [cached, focusLink]);

  // alias는 ?link=로 연 연결 id. 그 줄을 닫을 때 같이 지운다.
  const toggle = (id: string, alias?: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id) || (alias && next.has(alias))) {
        next.delete(id);
        if (alias) next.delete(alias);
      } else next.add(id);
      return next;
    });

  const header = (
    <div className="flex flex-col gap-1">
      <h1 className="text-lg font-semibold">없는 ID 찾기</h1>
      <p className="text-zinc-500">
        테이블끼리 이어진 곳을 모두 확인해, 다른 테이블에 없는 ID를 참조하는 행과 ID 컬럼에 같은 ID가 겹친 곳을 모읍니다. 예: 지워진 아이템을 주는 보상, 없는 퀘스트를 여는 조건.
      </p>
    </div>
  );

  if (sources.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <p className="text-zinc-500">불러온 테이블이 없습니다. 오른쪽 위의 파일 불러오기에서 테이블 엑셀을 불러와 주세요.</p>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {error ? <p className="text-red-600">테이블끼리 이어진 곳을 찾지 못했습니다. {error}</p> : progress && <ScanProgress progress={progress} />}
      </div>
    );
  }
  if (!cached) {
    const r = running?.key === key ? running : null;
    return (
      <div className="flex flex-col gap-3">
        {header}
        {failed?.key === key ? (
          <p className="text-red-600">확인하지 못했습니다. {failed.message}</p>
        ) : (
          <p className="inline-flex items-center gap-2 text-zinc-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {r ? `${r.done}/${r.total} 확인 중입니다.` : "확인을 시작하는 중입니다."} 처음 한 번만 걸리고, 파일이 바뀌기 전까지 다시 확인하지 않습니다.
          </p>
        )}
      </div>
    );
  }

  const label = (key: string, column?: string) => {
    const info = model.tables.get(key);
    const table = info?.table ?? key.slice(key.indexOf("/") + 1);
    return (
      <span>
        {info && <span className="text-zinc-400">{info.domain} · </span>}
        <Link href={tablePath(key)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {table}
        </Link>
        {column && <span className="font-mono text-zinc-500">.{column}</span>}
      </span>
    );
  };

  const problems = links
    .map((l) => ({ link: l, result: cached.missing.get(l.id)! }))
    .filter((x) => x.result && x.result.rows > 0)
    .sort((a, b) => b.result.rows - a.result.rows);
  const okCount = links.length - problems.length;
  const inactiveProblems = links
    .map((link) => ({ link, result: cached.inactive.get(link.id) }))
    .filter((x): x is { link: CheckLink; result: MissingResult } => !!x.result)
    .sort((a, b) => b.result.rows - a.result.rows);
  const missingRows = problems.reduce((n, p) => n + p.result.rows, 0);
  const focusOk = focusLink && links.some((l) => l.relationId === focusLink) && !problems.some((p) => p.link.relationId === focusLink);
  const tabCls = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-1.5 ${active ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`;

  return (
    <div className="flex flex-col gap-3">
      {header}
      <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800" aria-label="확인 종류">
        <button type="button" className={tabCls(tab === "missing")} onClick={() => setTab("missing")} aria-current={tab === "missing" ? "page" : undefined}>
          없는 ID {problems.length}곳
        </button>
        <button type="button" className={tabCls(tab === "inactive")} onClick={() => setTab("inactive")} aria-current={tab === "inactive" ? "page" : undefined}>
          비활성 행 참조 {inactiveProblems.length}곳
        </button>
        <button type="button" className={tabCls(tab === "dup")} onClick={() => setTab("dup")} aria-current={tab === "dup" ? "page" : undefined}>
          중복 ID {cached.duplicates.length}곳
        </button>
      </nav>

      {tab === "missing" ? (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            이어진 곳 {links.length.toLocaleString()}개 중 <strong>{problems.length.toLocaleString()}곳</strong>에서 다른 테이블에 없는 ID를 씁니다(모두{" "}
            {missingRows.toLocaleString()}행). 문제 없는 참조 관계는 {okCount.toLocaleString()}개입니다. 줄을 누르면 없는 ID 목록이 펼쳐지고, ID를 누르면 그 ID를 참조하는 행을 엽니다.
          </p>
          {focusOk && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">고른 참조 관계에는 없는 ID가 없습니다.</p>}
          {problems.length === 0 ? (
            <p className="text-zinc-500">없는 ID를 참조하는 곳이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-zinc-50 text-left dark:bg-zinc-800">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">ID를 참조하는 곳</th>
                    <th className="px-3 py-1.5 font-medium">ID가 있어야 할 곳</th>
                    <th className="px-3 py-1.5 text-right font-medium">없는 ID를 참조하는 행</th>
                    <th className="px-3 py-1.5 text-right font-medium">없는 ID 종류</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map(({ link, result }) => {
                    const isOpen = open.has(link.id) || open.has(link.relationId);
                    const Chevron = isOpen ? ChevronDown : ChevronRight;
                    return (
                      <FragmentRows key={link.id}>
                        <tr
                          data-link={link.relationId}
                          onClick={() => toggle(link.id, link.relationId)}
                          className={`cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60 ${focusLink === link.relationId ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                        >
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-1">
                              <Chevron className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                              {label(link.fromKey, link.from.column)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">{label(link.toKey, link.to.column)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">{result.rows.toLocaleString()}행</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{result.ids.toLocaleString()}개</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-800/30">
                            <td colSpan={4} className="px-3 py-2">
                              <ValueList values={result.top} total={result.ids} href={(v) => rowHref(link.from, v)} unit="행" />
                            </td>
                          </tr>
                        )}
                      </FragmentRows>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : tab === "inactive" ? (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            엑셀에서 Id 앞에 ;를 붙여 막아 둔(비활성) 행을 다른 테이블이 아직 참조하는 곳입니다. 게임에서 쓰지 않는 행이라 없는 ID처럼 문제가 되기 쉽습니다. 참조하는 행이 비활성이면(막아 둔 행끼리) 세지 않습니다.
            DB나 CSV로 연 테이블은 같은 이름의 엑셀 테이블에서 막아 둔 Id로 확인합니다.
          </p>
          {inactiveProblems.length === 0 ? (
            <p className="text-zinc-500">비활성 행을 참조하는 곳이 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {inactiveProblems.map(({ link, result }) => {
                const id = `off:${link.id}`;
                const isOpen = open.has(id);
                const Chevron = isOpen ? ChevronDown : ChevronRight;
                return (
                  <li key={link.id}>
                    <button type="button" onClick={() => toggle(id)} className="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <Chevron className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                      <span>{label(link.fromKey, link.from.column)}</span>
                      <span className="text-zinc-400">→</span>
                      <span className="min-w-0 flex-1">{label(link.toKey, link.to.column)}</span>
                      <span className="tabular-nums text-amber-700 dark:text-amber-400">
                        비활성 ID {result.ids.toLocaleString()}개, {result.rows.toLocaleString()}행
                      </span>
                    </button>
                    {isOpen && (
                      <div className="bg-zinc-50/60 px-3 py-2 dark:bg-zinc-800/30">
                        <ValueList values={result.top} total={result.ids} href={(v) => rowHref(link.from, v)} unit="행" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            다른 테이블이 참조하는 ID 컬럼에 같은 ID가 두 번 이상 있는 곳입니다. 어느 줄을 쓰게 될지 알 수 없어 버그가 나기 쉽습니다. 줄을 누르면 겹친 ID 목록이 펼쳐집니다.
          </p>
          {cached.duplicates.length === 0 ? (
            <p className="text-zinc-500">ID가 겹친 곳이 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {cached.duplicates.map(({ ref, key: k, result }) => {
                const id = `dup:${k}`;
                const isOpen = open.has(id);
                const Chevron = isOpen ? ChevronDown : ChevronRight;
                return (
                  <li key={k}>
                    <button type="button" onClick={() => toggle(id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <Chevron className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                      <span className="min-w-0 flex-1">{label(`${ref.sourceId}/${ref.table}`, ref.column)}</span>
                      <span className="tabular-nums text-amber-700 dark:text-amber-400">겹친 ID {result.values.toLocaleString()}개</span>
                    </button>
                    {isOpen && (
                      <div className="bg-zinc-50/60 px-3 py-2 dark:bg-zinc-800/30">
                        <ValueList values={result.top} total={result.values} href={(v) => rowHref(ref, v)} unit="번" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function ValueList({ values, total, href, unit }: { values: { value: string; rows: number }[]; total: number; href: (v: string) => string; unit: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <li key={v.value}>
            <Link
              href={href(v.value)}
              className="inline-flex items-baseline gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
              title="이 ID를 참조하는 행 열기"
            >
              <span className="font-mono">{v.value}</span>
              <span className="tabular-nums text-zinc-400">
                {v.rows.toLocaleString()}
                {unit}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > values.length && <p className="text-zinc-500">많은 순서로 {TOP_LIMIT}개만 보여줍니다. 모두 {total.toLocaleString()}개입니다.</p>}
    </div>
  );
}
