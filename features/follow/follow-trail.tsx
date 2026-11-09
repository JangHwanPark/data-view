"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, X } from "lucide-react";
import { FollowPanel } from "./follow-panel";
import { sourceTableLabel } from "@/features/relations";
import { useWorkspace } from "@/core/ui/workspace-provider";
import type { TrailStep } from "@/core/follow";

interface Props {
  trail: TrailStep[];
  onChange: (trail: TrailStep[]) => void;
}

// 지나온 경로와 단계별 패널을 가로로 이어 보여준다.
export function FollowTrail({ trail, onChange }: Props) {
  const { sources } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 단계가 열리면 오른쪽 끝으로 스크롤한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [trail.length]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {trail.map((step, i) => {
          const source = sources.find((s) => s.meta.id === step.sourceId);
          return (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-zinc-400" aria-hidden />}
              <button
                type="button"
                onClick={() => onChange(trail.slice(0, i + 1))}
                className="rounded bg-zinc-100 px-1.5 py-0.5 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                title={sourceTableLabel(source, step.table)}
              >
                {step.table}.{step.column} = <span className="font-medium">{step.value}</span>
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="size-3" aria-hidden />
          모두 닫기
        </button>
      </div>
      <div ref={scrollRef} className="flex items-start gap-3 overflow-x-auto pb-2">
        {trail.map((step, i) => (
          <FollowPanel
            key={`${i}:${JSON.stringify(step)}`}
            step={step}
            onFollow={(next) => onChange([...trail.slice(0, i + 1), next])}
            onClose={() => onChange(trail.slice(0, i))}
          />
        ))}
      </div>
    </div>
  );
}
