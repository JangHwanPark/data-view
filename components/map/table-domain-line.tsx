"use client";

import Link from "next/link";
import { Loader2, Network } from "lucide-react";
import { RoleBadge, tablePath } from "@/components/map/map-parts";
import { useDomainModel } from "@/components/use-domain-model";
import { ROLE_HELP } from "@/lib/client/domain-model";

// 테이블 화면 제목 아래의 한 줄(설계 4.12 D8). 이 테이블이 어느 도메인의 어떤 역할인지 알려 준다.
export function TableDomainLine({ sourceId, table }: { sourceId: string; table: string }) {
  const { model, progress } = useDomainModel();
  if (!model) {
    return progress ? (
      <p className="-mt-2 inline-flex items-center gap-1 text-xs text-zinc-400">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        도메인과 역할을 찾는 중{progress.total ? ` (${progress.done}/${progress.total})` : ""}
      </p>
    ) : null;
  }
  const info = model.tables.get(`${sourceId}/${table}`);
  if (!info) return null;
  const parent = info.parent ? model.tables.get(info.parent) : null;
  return (
    <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
      <Link href={`/map?domain=${encodeURIComponent(info.domain)}`} className="inline-flex items-center gap-1 text-zinc-700 hover:underline dark:text-zinc-300">
        <Network className="size-3.5" aria-hidden />
        {info.domain} 도메인
      </Link>
      <RoleBadge role={info.role} />
      <span>
        {ROLE_HELP[info.role]}
        {parent && (
          <>
            {" "}
            부모:{" "}
            <Link href={tablePath(parent.key)} className="text-blue-700 hover:underline dark:text-blue-400">
              {parent.table}
            </Link>
          </>
        )}
      </span>
      <span className="text-zinc-400">
        가리키는 테이블 {info.out.length}, 가리켜지는 테이블 {info.in.length}
      </span>
    </p>
  );
}
