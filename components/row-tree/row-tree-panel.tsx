"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { RoleBadge, ScanProgress } from "@/components/map/map-parts";
import { useDomainModel } from "@/components/use-domain-model";
import { tableHref } from "@/lib/client/doc-links";
import type { DomainModel } from "@/lib/client/domain-model";
import { loadRow, usedByGroups, usesGroups, type RowGroup, type RowNode } from "@/lib/client/row-tree";

// 행 하나에서 출발하는 두 가지 트리(설계 4.9). 데이터 표의 행 번호를 누르면 오른쪽에 열린다.
// 처음에는 두 단계까지 펼쳐 두고, 그다음은 노드를 누를 때마다 한 단계씩 펼친다.
type Mode = "uses" | "usedBy";
const AUTO_OPEN_DEPTH = 2;

interface Props {
  here: string; // 테이블 키
  column: string;
  value: string;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onClose: () => void;
}

export function RowTreePanel({ here, column, value, mode, onMode, onClose }: Props) {
  const { model, progress } = useDomainModel();
  const [root, setRoot] = useState<{ id: string; node: RowNode | "error" } | null>(null);
  const id = `${here}|${column}|${value}`;

  useEffect(() => {
    if (!model) return;
    let active = true;
    loadRow(model, here, column, value)
      .then((node) => active && setRoot({ id, node }))
      .catch(() => active && setRoot({ id, node: "error" }));
    return () => {
      active = false;
    };
    // here, column, value는 id에 들어 있다. 모델은 렌더마다 새로 만들어지므로 준비됐는지만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!model]);

  const node = root?.id === id ? root.node : null;
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => onMode(m)}
      aria-pressed={mode === m}
      className={`rounded px-2 py-0.5 ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
    >
      {label}
    </button>
  );

  return (
    <aside className="flex w-full shrink-0 flex-col rounded-lg border border-zinc-200 bg-white xl:w-[520px] dark:border-zinc-800 dark:bg-zinc-900" aria-label="행 트리">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
        {tab("uses", "이 행이 쓰는 것")}
        {tab("usedBy", "이 행을 쓰는 곳")}
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label="행 트리 닫기">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="max-h-[calc(100vh-14rem)] overflow-auto p-3 text-xs">
        <p className="mb-2 text-zinc-500">
          {mode === "uses"
            ? "이 행이 가리키는 행과 세부 행을 끝까지 펼칩니다. 예: 퀘스트 → 보상 그룹 → 보상 → 아이템."
            : "이 행을 쓰는 곳을 거꾸로 따라갑니다. 보상처럼 세부 행이 쓰면 그 위 행(보상 그룹)으로 올려서 이어 갑니다."}
        </p>
        {!model ? (
          progress ? <ScanProgress progress={progress} /> : <Spinner text="연결을 찾는 중" />
        ) : !node ? (
          <Spinner text="행을 읽는 중" />
        ) : node === "error" ? (
          <p className="text-red-600">행을 읽지 못했습니다.</p>
        ) : (
          <Tree key={`${id}|${mode}`} model={model} node={node} mode={mode} depth={0} ancestors={new Set()} />
        )}
      </div>
    </aside>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-zinc-500">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {text}
    </p>
  );
}

const nodeId = (n: RowNode) => `${n.key}|${n.idColumn}|${n.idValue}`;

interface TreeProps {
  model: DomainModel;
  node: RowNode;
  mode: Mode;
  depth: number;
  ancestors: Set<string>; // 위에서 이미 나온 행. 순환 참조(이전 퀘스트)에서 끝없이 펼쳐지지 않게 한다
}

function Tree({ model, node, mode, depth, ancestors }: TreeProps) {
  const repeat = node.unique && ancestors.has(nodeId(node));
  const expandable = !!node.values && !repeat;
  const [open, setOpen] = useState(expandable && depth < AUTO_OPEN_DEPTH);
  const [groups, setGroups] = useState<RowGroup[] | "error" | null>(null);

  // 도메인 모델은 렌더마다 새로 만들어지므로 펼침 요청의 조건에는 넣지 않는다. 넣으면 요청이 끝나기 전에 계속 다시 시작한다.
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  });
  useEffect(() => {
    if (!open || groups !== null) return;
    let active = true;
    (mode === "uses" ? usesGroups(modelRef.current, node) : usedByGroups(modelRef.current, node))
      .then((g) => active && setGroups(g))
      .catch(() => active && setGroups("error"));
    return () => {
      active = false;
    };
  }, [open, groups, mode, node]);

  const info = model.tables.get(node.key);
  const Chevron = open ? ChevronDown : ChevronRight;
  const { sourceId, table } = { sourceId: node.key.slice(0, node.key.indexOf("/")), table: node.table };
  const nextAncestors = new Set(ancestors).add(nodeId(node));

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={!expandable}
          className="mt-0.5 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:invisible dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={open ? "접기" : "펼치기"}
          aria-expanded={open}
        >
          <Chevron className="size-3.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 leading-5">
          <span className="text-zinc-500">{table}</span>{" "}
          {node.values && !node.unique ? (
            // 세부 행(보상)은 첫 열이 위 테이블의 ID라 이름처럼 보이면 헷갈린다. 주요 값으로 알아보게 한다.
            <Link href={tableHref(sourceId, table, { column: node.idColumn, value: node.idValue })} className="text-zinc-400 hover:underline">
              행
            </Link>
          ) : node.values ? (
            <Link href={tableHref(sourceId, table, { column: node.idColumn, value: node.idValue })} className="font-medium tabular-nums hover:underline">
              {node.idValue}
            </Link>
          ) : (
            <span className="font-medium tabular-nums text-red-700 dark:text-red-400">{node.idValue}</span>
          )}
          {node.title && <span className="ml-1 text-zinc-900 dark:text-zinc-100">{node.title}</span>}
          {info && depth === 0 && <span className="ml-1.5 align-middle"><RoleBadge role={info.role} /></span>}
          {!node.values && <span className="ml-1 text-red-600 dark:text-red-400">데이터에 없는 ID</span>}
          {repeat && <span className="ml-1 text-zinc-400">(위에서 이미 나온 행)</span>}
          {node.via && <span className="ml-1 text-zinc-400">({node.via})</span>}
          {node.summary && <p className="truncate text-zinc-500" title={node.summary}>{node.summary}</p>}
        </div>
      </div>
      {open && (
        <div className="ml-2 border-l border-zinc-200 pl-3 dark:border-zinc-700">
          {groups === null ? (
            <Spinner text="찾는 중" />
          ) : groups === "error" ? (
            <p className="text-red-600">펼치지 못했습니다.</p>
          ) : groups.length === 0 ? (
            <p className="py-0.5 text-zinc-400">{mode === "uses" ? "이 행이 쓰는 다른 행이 없습니다." : "이 행을 쓰는 곳이 없습니다."}</p>
          ) : (
            groups.map((g) => (
              <div key={`${g.kind}|${g.label}`} className="py-0.5">
                <p className={`font-mono text-[11px] ${g.kind === "detail" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-400"}`}>
                  {g.label} · {g.note ?? `${g.total.toLocaleString()}개`}
                </p>
                {g.nodes.map((n, i) => (
                  <Tree key={`${nodeId(n)}|${i}`} model={model} node={n} mode={mode} depth={depth + 1} ancestors={nextAncestors} />
                ))}
                {!g.note && g.total > g.nodes.length && <p className="pl-5 text-zinc-400">외 {(g.total - g.nodes.length).toLocaleString()}개</p>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
