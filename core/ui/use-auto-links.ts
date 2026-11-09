"use client";

import { useEffect, useState } from "react";
import { sourceVersion, useWorkspace } from "@/core/ui/workspace-provider";
import { findAutoLinks, type AutoLink } from "@/core/auto-links";
import type { Relation } from "@/core/relations";

// 여러 테이블의 자동 연결을 한 번에 구한다. 테이블 화면(가운데와 이웃), 따라가기 패널이 같이 쓴다.
// 결과는 저장한 관계와 합친 목록(relations)과 자동 연결의 근거(reasons)다.
export function useLinkedRelations(targets: { sourceId: string; table: string }[]) {
  const { sources, relations, initialized } = useWorkspace();
  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const version = ready.map(sourceVersion).join("|");
  const requestKey = loading ? null : JSON.stringify([version, targets.map((t) => `${t.sourceId}/${t.table}`).sort(), relations.map((r) => r.id)]);
  const [loaded, setLoaded] = useState<{ key: string; links: AutoLink[] } | null>(null);

  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    const tables = ready.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
    const kinds = new Map(ready.map((s) => [s.meta.id, s.meta.kind === "mysql" ? "db" : "file"]));
    Promise.all(targets.map((t) => findAutoLinks(version, tables, t, relations, kinds)))
      .then((lists) => {
        if (!active) return;
        // 두 테이블이 서로를 찾으면 같은 연결이 두 번 나오므로 id로 한 번만 남긴다.
        const unique = new Map(lists.flat().map((l) => [l.relation.id, l]));
        setLoaded({ key: requestKey, links: [...unique.values()] });
      })
      .catch(() => active && setLoaded({ key: requestKey, links: [] }));
    return () => {
      active = false;
    };
    // targets, ready, relations는 requestKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const auto = loaded?.key === requestKey ? loaded.links : null;
  const merged: Relation[] = auto ? [...relations, ...auto.map((l) => l.relation)] : relations;
  const reasons = new Map((auto ?? []).map((l) => [l.relation.id, l.reason]));
  return { relations: merged, reasons, ready: auto !== null };
}
