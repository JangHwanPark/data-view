"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { RoleBadge } from "@/components/map/map-parts";
import { useDomainModel } from "@/components/use-domain-model";
import { useWorkspace } from "@/components/workspace-provider";
import { parseGlossary } from "@/lib/client/doc-infer";
import { normalizeName } from "@/lib/client/doc-infer";
import { explainTarget, explainValue, type Explanation } from "@/lib/client/value-explain";

// 표의 값에 마우스를 올리면 그 값이 어떤 데이터인지 보여준다(설계 6.4).
// 칸마다 말풍선을 두지 않고, 화면에 하나만 두어 지금 올린 칸의 설명을 그린다.

interface Hover {
  here: string; // 칸이 있는 테이블 키
  column: string;
  firstColumn: string | null;
  value: string;
  row?: Record<string, unknown>; // 같은 행의 값. 타입+ID 열이 어느 테이블을 가리키는지 고를 때 쓴다
  x: number;
  y: number;
  bottom: number;
}

let hover: Hover | null = null;
const listeners = new Set<() => void>();
function setHover(next: Hover | null) {
  hover = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const DELAY = 300; // 표를 훑으며 지나갈 때마다 뜨지 않도록 잠깐 머물렀을 때만 보여준다

// 설명을 볼 수 있는 열인지. 다른 테이블을 쓰는 열과 행 자신의 ID 열(첫 열)이다.
export function useExplainable(here: string | undefined, firstColumn: string | null) {
  const { model } = useDomainModel();
  // 타입+ID 열은 행의 종류 값에 맞는 연결이 있을 때만 설명을 단다(reward_type이 CURRENCY인데 연결이 ITEM뿐이면 달지 않는다).
  return (column: string, row?: () => Record<string, unknown>) => {
    if (!here || !model) return false;
    const typed = model.tables.get(here)?.out.some((l) => l.column === column && l.when);
    return explainTarget(model, here, column, firstColumn, typed && row ? row() : undefined) !== null;
  };
}

// 표의 한 행을 열 이름 → 값으로 바꾼다. 마우스를 올렸을 때만 부른다.
export function rowRecord(columns: { name: string }[], row: unknown[]) {
  return Object.fromEntries(columns.map((c, i) => [c.name, row[i]]));
}

interface CellProps {
  here: string;
  column: string;
  firstColumn: string | null;
  value: unknown;
  row?: () => Record<string, unknown>;
  children: ReactNode;
}

// 칸 내용을 감싼다. 값은 그대로 두고, 마우스를 잠깐 올리면 설명을 띄운다.
export function ExplainCell({ here, column, firstColumn, value, row, children }: CellProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (value === null || value === undefined || value === "") return <>{children}</>;
  return (
    <span
      className="cursor-help decoration-zinc-400 decoration-dotted underline-offset-2 hover:underline"
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setHover({ here, column, firstColumn, value: String(value), row: row?.(), x: rect.left, y: rect.top, bottom: rect.bottom }), DELAY);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setHover(null);
      }}
    >
      {children}
    </span>
  );
}

// 레이아웃에 한 번 둔다.
export function ExplainLayer() {
  const current = useSyncExternalStore(subscribe, () => hover, () => null);
  const { model } = useDomainModel();
  const [loaded, setLoaded] = useState<{ id: string; value: Explanation | "error" } | null>(null);
  const target = current && model ? explainTarget(model, current.here, current.column, current.firstColumn, current.row) : null;
  const id = current && target ? `${target.key}|${target.column}|${current.value}` : null;

  useEffect(() => {
    if (!id || !model || !target || !current) return;
    let active = true;
    explainValue(model, target, current.value)
      .then((value) => active && setLoaded({ id, value }))
      .catch(() => active && setLoaded({ id, value: "error" }));
    return () => {
      active = false;
    };
    // target과 current.value는 id에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, model]);

  if (!current || !target || !model) return null;
  const result = loaded?.id === id ? loaded.value : null;
  // 화면 아래쪽 칸이면 위로 띄운다.
  const below = current.bottom + 300 < (typeof window !== "undefined" ? window.innerHeight : 800);
  const left = Math.max(8, Math.min(current.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 376));
  const style = below ? { left, top: current.bottom + 6 } : { left, bottom: (typeof window !== "undefined" ? window.innerHeight : 800) - current.y + 6 };

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-[360px] rounded-md border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={style}
    >
      {result === null ? (
        <p className="inline-flex items-center gap-1.5 text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {current.value}이(가) 어떤 데이터인지 찾는 중
        </p>
      ) : result === "error" ? (
        <p className="text-red-600">이 값의 데이터를 찾지 못했습니다.</p>
      ) : (
        <ExplainBody e={result} self={target.key === current.here && target.column === current.column} />
      )}
    </div>
  );
}

function ExplainBody({ e, self }: { e: Explanation; self: boolean }) {
  const { model } = useDomainModel();
  const { glossary } = useWorkspace();
  const info = model?.tables.get(e.key);
  const korean = koreanName(e.table, glossary);
  const head = (
    <p className="flex flex-wrap items-center gap-x-1.5 text-zinc-500">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {korean ? `${korean}(${e.table})` : e.table}
      </span>
      {info && <span>· {info.domain} 시스템</span>}
      {info && <RoleBadge role={info.role} />}
    </p>
  );
  if (!e.found) {
    return (
      <div className="flex flex-col gap-1.5">
        {head}
        <p className="font-medium text-red-700 dark:text-red-400">
          {e.table}에 {e.value}이(가) 없습니다.
        </p>
        <p className="text-zinc-500">지워진 ID이거나 아직 데이터에 넣지 않은 ID일 수 있습니다. 없는 ID 찾기에서 같은 문제를 모아 볼 수 있습니다.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {head}
      <div>
        <p className="text-sm font-semibold break-all text-zinc-900 dark:text-zinc-100">{e.title ?? `${e.column} ${e.value}`}</p>
        <p className="text-zinc-500">
          {self ? "이 행" : `${e.table}의 ${e.column} = ${e.value}`}
          {e.title && e.titleFrom ? ` · 이름은 ${e.titleFrom}에서` : ""}
          {e.matches > 1 ? ` · 같은 값의 행 ${e.matches.toLocaleString()}개 중 첫 행` : ""}
        </p>
      </div>
      {e.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {e.fields.map((f) => (
            <div key={f.column} className="contents">
              <dt className="font-mono text-[11px] text-zinc-500">{f.column}</dt>
              <dd className="break-all">
                <span className="tabular-nums">{f.value}</span>
                {f.meaning && <span className={f.meaning.includes("없는 ID") ? "text-red-600 dark:text-red-400" : "text-zinc-500"}> · {f.meaning}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {e.children.map((c) => (
        <div key={c.key} className="border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
          <p className="font-medium">
            {c.table} {c.count.toLocaleString()}개
          </p>
          <ul className="text-zinc-600 dark:text-zinc-400">
            {c.samples.map((s, i) => (
              <li key={i} className="break-all">
                {s}
              </li>
            ))}
            {c.count > c.samples.length && <li className="text-zinc-400">외 {(c.count - c.samples.length).toLocaleString()}개</li>}
          </ul>
        </div>
      ))}
      {e.usedBy.length > 0 && (
        <p className="border-t border-zinc-100 pt-1.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          쓰이는 곳: {e.usedBy.map((u) => `${u.table} ${u.count.toLocaleString()}행(${u.column})`).join(", ")}
        </p>
      )}
    </div>
  );
}

// 기획서 이름 짝(아이템=Item)을 거꾸로 써서 테이블 이름의 한글 이름을 찾는다. 짝이 없으면 영어 이름만 쓴다.
function koreanName(table: string, glossary: string) {
  const n = normalizeName(table);
  for (const [ko, en] of parseGlossary(glossary)) if (normalizeName(en) === n) return ko;
  return null;
}
