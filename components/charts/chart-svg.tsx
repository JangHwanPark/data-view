"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartKind, ChartPoint } from "@/lib/chart-spec";

// 차트 그림(32단계). 계열이 하나라 색은 파랑 하나(--viz-series-1)만 쓰고, 이름은 차트 제목이 말한다(범례 없음).
// 막대는 얇게, 값 끝만 4px 둥글게, 막대 사이 2px 틈. 선은 2px. 격자와 축은 흐리게. 글자는 계열 색이 아니라 글자 색.
// 마우스를 올리면 막대·칸마다 풍선 도움말, 선은 세로 십자선과 점(8px)이 따라간다. 숫자는 많은 쪽 3개에만 바로 적는다.

const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(Number(t.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

interface Props {
  kind: ChartKind;
  points: ChartPoint[];
  valueLabel: string; // 「행 수」, 「sell_price 합계」
  xLabel: string;
}

export function ChartSvg(props: Props) {
  const { ref, width } = useWidth();
  return (
    <div ref={ref} className="relative w-full">
      {props.points.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">그릴 값이 없습니다. 조건을 바꿔 보세요.</p>
      ) : props.kind === "bar" ? (
        <BarChart {...props} width={width} />
      ) : props.kind === "line" ? (
        <LineChart {...props} width={width} />
      ) : (
        <Histogram {...props} width={width} />
      )}
    </div>
  );
}

function Tooltip({ x, y, title, value }: { x: number; y: number; title: string; value: string }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left: x, top: y - 6, color: "var(--viz-text-primary)" }}
    >
      <div style={{ color: "var(--viz-text-secondary)" }}>{title}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

// 가로 막대(많은 순). 막대마다 한 줄, 왼쪽에 이름.
function BarChart({ points, valueLabel, width }: Props & { width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const labelW = Math.min(180, Math.max(90, width * 0.28));
  const right = 56;
  const row = 26;
  const barH = 16;
  const top = 22;
  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const scaleMax = ticks[ticks.length - 1] || 1;
  const plotW = width - labelW - right;
  const height = top + points.length * row + 8;
  const xOf = (v: number) => labelW + (Math.max(0, v) / scaleMax) * plotW;
  const total = points.reduce((n, p) => n + p.value, 0);
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${valueLabel} 가로 막대 차트, 막대 ${points.length}개`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xOf(t)} x2={xOf(t)} y1={top - 4} y2={height - 8} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={xOf(t)} y={12} textAnchor="middle" fontSize={11} fill="var(--viz-text-secondary)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const y = top + i * row;
          const w = Math.max(0, xOf(p.value) - labelW);
          const r = Math.min(4, w / 2, barH / 2);
          // 값 끝(오른쪽)만 둥글게, 기준선(왼쪽)은 각지게
          const d = w <= 0 ? "" : `M${labelW},${y + (row - barH) / 2} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} z`;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* 막대보다 넓은 마우스 영역 */}
              <rect x={0} y={y} width={width} height={row} fill={hover === i ? "var(--viz-grid)" : "transparent"} opacity={0.5} />
              <text x={labelW - 8} y={y + row / 2 + 4} textAnchor="end" fontSize={12} fill="var(--viz-text-secondary)">
                {p.label.length > 24 ? `${p.label.slice(0, 23)}…` : p.label}
              </text>
              {d && <path d={d} fill="var(--viz-series-1)" />}
              {i < 3 && (
                <text x={xOf(p.value) + 6} y={y + row / 2 + 4} fontSize={12} fill="var(--viz-text-primary)" className="tabular-nums">
                  {fmt(p.value)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={labelW} x2={labelW} y1={top - 4} y2={height - 8} stroke="var(--viz-axis)" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <Tooltip
          x={Math.min(width - 80, xOf(points[hover].value))}
          y={top + hover * row + 4}
          title={points[hover].label}
          value={`${valueLabel} ${fmt(points[hover].value)}${total > 0 && valueLabel.includes("행 수") ? ` (${((points[hover].value / total) * 100).toFixed(1)}%)` : ""}`}
        />
      )}
    </>
  );
}

// 선(가로축 순서대로). 가로축 글자는 6개 안팎으로 솎는다.
function LineChart({ points, valueLabel, xLabel, width }: Props & { width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const left = 56;
  const right = 16;
  const top = 12;
  const height = 280;
  const bottom = 40;
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.max(0, ...values));
  const scaleMax = ticks[ticks.length - 1] || 1;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const xOf = (i: number) => left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yOf = (v: number) => top + plotH - (Math.max(0, v) / scaleMax) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${valueLabel} 선 차트, 점 ${points.length}개`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left - left) / plotW) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={yOf(t)} y2={yOf(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={left - 6} y={yOf(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-text-secondary)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={i} x={xOf(i)} y={height - bottom + 16} textAnchor="middle" fontSize={11} fill="var(--viz-text-secondary)">
              {p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label}
            </text>
          ) : null,
        )}
        <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--viz-text-secondary)">
          {xLabel}
        </text>
        <line x1={left} x2={width - right} y1={top + plotH} y2={top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--viz-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <g>
            <line x1={xOf(hover)} x2={xOf(hover)} y1={top} y2={top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
            <circle cx={xOf(hover)} cy={yOf(points[hover].value)} r={4.5} fill="var(--viz-series-1)" stroke="var(--background)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && <Tooltip x={xOf(hover)} y={yOf(points[hover].value)} title={`${xLabel} ${points[hover].label}`} value={`${valueLabel} ${fmt(points[hover].value)}`} />}
    </>
  );
}

// 분포: 숫자 구간마다 세로 막대. 구간 사이 2px 틈, 값 끝(위)만 둥글게.
function Histogram({ points, xLabel, width }: Props & { width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const left = 56;
  const right = 16;
  const top = 12;
  const height = 260;
  const bottom = 40;
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value)));
  const scaleMax = ticks[ticks.length - 1] || 1;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const slot = plotW / points.length;
  const yOf = (v: number) => top + plotH - (v / scaleMax) * plotH;
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${xLabel} 분포, 구간 ${points.length}개`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={yOf(t)} y2={yOf(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={left - 6} y={yOf(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-text-secondary)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = left + i * slot + 1;
          const w = Math.max(1, slot - 2);
          const h = Math.max(0, top + plotH - yOf(p.value));
          const r = Math.min(4, w / 2, h);
          const d = h <= 0 ? "" : `M${x},${top + plotH} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} fill={hover === i ? "var(--viz-grid)" : "transparent"} opacity={0.5} />
              {d && <path d={d} fill="var(--viz-series-1)" />}
            </g>
          );
        })}
        <line x1={left} x2={width - right} y1={top + plotH} y2={top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text key={i} x={left + i * slot + (i === points.length - 1 ? slot : 0)} y={height - bottom + 16} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--viz-text-secondary)">
            {fmt(i === points.length - 1 ? (points[i].to ?? 0) : (points[i].from ?? 0))}
          </text>
        ))}
        <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--viz-text-secondary)">
          {xLabel}
        </text>
      </svg>
      {hover !== null && <Tooltip x={left + hover * slot + slot / 2} y={yOf(points[hover].value)} title={`${xLabel} ${points[hover].label}`} value={`행 수 ${fmt(points[hover].value)}`} />}
    </>
  );
}
