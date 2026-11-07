"use client";

import { useSyncExternalStore } from "react";
import { readCharts, readDashboard, writeCharts, writeDashboard, type Dashboard, type SavedChart } from "@/lib/client/opfs";
import type { WorkspaceSource } from "@/components/workspace-provider";

// 저장한 차트와 대시보드 배치(34단계). 차트 화면과 대시보드가 같이 보므로 모듈에 두고 OPFS에 저장한다.
let charts: SavedChart[] | null = null;
let dashboard: Dashboard | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let loading: Promise<void> | null = null;

function load() {
  loading ??= Promise.all([readCharts(), readDashboard()])
    .then(([c, d]) => {
      charts = c;
      dashboard = d;
      emit();
    })
    .catch(() => {
      charts = [];
      dashboard = { items: [], refreshMinutes: 0 };
      emit();
    });
}

const EMPTY_CHARTS: SavedChart[] = [];
const EMPTY_DASH: Dashboard = { items: [], refreshMinutes: 0 };

export function useSavedCharts() {
  const subscribe = (l: () => void) => {
    load();
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const list = useSyncExternalStore(subscribe, () => charts ?? EMPTY_CHARTS, () => EMPTY_CHARTS);
  const dash = useSyncExternalStore(subscribe, () => dashboard ?? EMPTY_DASH, () => EMPTY_DASH);
  return { charts: list, dashboard: dash, loaded: charts !== null };
}

export async function saveCharts(next: SavedChart[]) {
  charts = next;
  // 지운 차트는 대시보드에서도 뺀다.
  if (dashboard) dashboard = { ...dashboard, items: dashboard.items.filter((i) => next.some((c) => c.id === i.chartId)) };
  emit();
  await writeCharts(next);
  if (dashboard) await writeDashboard(dashboard);
}

export async function saveDashboard(next: Dashboard) {
  dashboard = next;
  emit();
  await writeDashboard(next);
}

// 저장한 차트의 소스. id가 그대로면 그 소스, 아니면 이름과 테이블이 같은 소스.
export function resolveSource(chart: SavedChart, sources: WorkspaceSource[]) {
  return (
    sources.find((s) => s.meta.id === chart.sourceId && s.tables.includes(chart.table)) ??
    sources.find((s) => s.meta.name === chart.sourceName && s.tables.includes(chart.table)) ??
    null
  );
}
