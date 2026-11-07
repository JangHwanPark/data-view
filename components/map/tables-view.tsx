"use client";

import { useState } from "react";
import { MapTabs, RoleBadge, RoleLegend, ScanProgress } from "@/components/map/map-parts";
import { TableCard } from "@/components/map/table-card";
import { useDomainModel } from "@/components/use-domain-model";
import { useWorkspace } from "@/components/workspace-provider";
import { ROLE_LABEL, ROLE_ORDER, type TableRole } from "@/lib/client/domain-model";

// 테이블별 연결(설계 4.12 D7). 모든 테이블을 도메인별로 묶어, 테이블마다 무엇과 이어지는지 그림으로 보여준다.
export function TablesView() {
  const { sources, initialized } = useWorkspace();
  const { model, progress, rowCounts, error } = useDomainModel();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<TableRole | "all">("all");

  const header = (
    <>
      <MapTabs active="tables" />
      <p className="text-zinc-500">
        테이블마다 왼쪽은 이 테이블을 참조하는 곳, 오른쪽은 이 테이블의 참조 대상입니다(퀘스트 → 보상 그룹이면 퀘스트가 보상 그룹을 참조함). 다른 시스템의 테이블은 시스템 이름을 앞에 붙입니다. 앱이 컬럼 이름과 값으로 찾은 참조 관계와 사람이 확인한 참조 관계를 같이 보여줍니다.
      </p>
    </>
  );

  if (!initialized) return <div className="flex flex-col gap-3">{header}</div>;
  if (!sources.length) {
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

  const q = query.trim().toLowerCase();
  // 이름은 테이블, 도메인, 이어진 열 이름으로 거른다. reward_group_id로 찾으면 그 열로 이어진 테이블이 모두 나온다.
  const matches = (key: string) => {
    const info = model.tables.get(key)!;
    if (role !== "all" && info.role !== role) return false;
    if (!q) return true;
    const words = [info.table, info.domain, ...info.in.map((l) => l.column), ...info.out.map((l) => l.column)];
    return words.some((w) => w.toLowerCase().includes(q));
  };
  const counts = new Map<TableRole, number>();
  for (const t of model.tables.values()) counts.set(t.role, (counts.get(t.role) ?? 0) + 1);
  const domainNames = model.domains.map((d) => d.name);
  const groups = model.domains.map((d) => ({ domain: d, keys: d.tables.filter(matches) })).filter((g) => g.keys.length);

  return (
    <div className="flex flex-col gap-3">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="테이블, 시스템, 컬럼 이름으로 거르기"
          aria-label="테이블 거르기"
          className="w-64 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex gap-1">
          {(["all", ...ROLE_ORDER] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded px-2 py-0.5 text-xs ${role === r ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}
            >
              {r === "all" ? `전체 ${model.tables.size}` : `${ROLE_LABEL[r]} ${counts.get(r) ?? 0}`}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <RoleLegend />
        </div>
      </div>

      {groups.length === 0 && <p className="text-zinc-500">조건에 맞는 테이블이 없습니다.</p>}
      {groups.map(({ domain, keys }) => (
        <section key={domain.name} className="flex flex-col gap-1.5">
          <h2 className="flex flex-wrap items-baseline gap-x-2 border-b border-zinc-200 pb-1 dark:border-zinc-800">
            <span className="font-semibold">{domain.name}</span>
            <span className="text-xs text-zinc-500">테이블 {domain.tables.length}개</span>
            <span className="flex flex-wrap gap-2">
              {ROLE_ORDER.filter((r) => domain.tables.some((k) => model.tables.get(k)!.role === r)).map((r) => (
                <RoleBadge key={r} role={r} />
              ))}
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
            {keys.map((k) => (
              <TableCard key={k} info={model.tables.get(k)!} model={model} rows={rowCounts.get(k)} domains={domainNames} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
