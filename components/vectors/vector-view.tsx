"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Boxes, Loader2, Search, Table2, Upload } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { flattenPayload, pca2d, scrollPoints, similarPoints, toCsv, vectorOf, vectorStatus, type CollectionInfo, type QPoint, type VectorStatus } from "@/lib/client/vectors";

// 벡터 DB(PLAN 33단계, Qdrant). 컬렉션 통계 → payload를 표로 불러오기(DuckDB) → 산점도 → 비슷한 점 찾기.
// 읽기만 하고, 주소와 키는 .env.local(QDRANT_URL, QDRANT_API_KEY)에 둔다.

const SERIES = ["var(--viz-series-1)", "var(--viz-series-2)", "var(--viz-series-3)"];

export function VectorView() {
  const [status, setStatus] = useState<VectorStatus | { error: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    vectorStatus()
      .then(setStatus)
      .catch((e) => setStatus({ error: e instanceof Error ? e.message : String(e) }));
  }, []);

  const header = (
    <div className="flex flex-col gap-1">
      <h1 className="inline-flex items-center gap-2 text-lg font-semibold">
        <Boxes className="size-5" aria-hidden />
        벡터 DB
      </h1>
      <p className="text-zinc-500">Qdrant 컬렉션의 점 수와 벡터 크기를 보고, payload를 표로 불러와 다른 테이블처럼 거르고 차트로 그리며, 벡터를 2차원으로 펼친 산점도에서 무리를 보고, 점 하나와 비슷한 점을 찾습니다. 읽기만 합니다.</p>
    </div>
  );
  if (!status)
    return (
      <div className="flex flex-col gap-3">
        {header}
        <p className="inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          연결하는 중
        </p>
      </div>
    );
  if ("error" in status)
    return (
      <div className="flex flex-col gap-3">
        {header}
        <p className="text-red-600">벡터 DB에 연결하지 못했습니다. 주소와 키(.env.local의 QDRANT_URL, QDRANT_API_KEY)를 확인해 주세요. {status.error}</p>
      </div>
    );
  if (!status.configured)
    return (
      <div className="flex flex-col gap-3">
        {header}
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          연결할 벡터 DB가 없습니다. 앱 폴더의 .env.local에 <code className="font-mono">QDRANT_URL=http://주소:6333</code>과(키가 있으면) <code className="font-mono">QDRANT_API_KEY=…</code>를 적고 앱을 다시 켜 주세요. 키는 이 PC의 서버에만 있고 브라우저로 보내지 않습니다.
        </p>
      </div>
    );

  const current = status.collections.find((c) => c.name === picked) ?? status.collections[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      {header}
      <p className="text-xs text-zinc-500">
        {status.url} · 키 {status.hasKey ? "있음" : "없음"} · 컬렉션 {status.collections.length}개
      </p>
      <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-1.5 font-medium">컬렉션</th>
              <th className="px-3 py-1.5 text-right font-medium">점 수</th>
              <th className="px-3 py-1.5 text-right font-medium">벡터 크기</th>
              <th className="px-3 py-1.5 font-medium">거리</th>
              <th className="px-3 py-1.5 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {status.collections.map((c) => (
              <tr key={c.name} onClick={() => setPicked(c.name)} className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${c.name === current?.name ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"}`}>
                <td className="px-3 py-1.5 font-mono">{c.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.points.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.size ?? "-"}</td>
                <td className="px-3 py-1.5">{c.distance ?? "-"}{c.named.length ? ` (이름 붙은 벡터 ${c.named.join(", ")})` : ""}</td>
                <td className="px-3 py-1.5">{c.status === "green" ? "정상" : c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && <CollectionPanel key={current.name} c={current} />}
    </div>
  );
}

function CollectionPanel({ c }: { c: CollectionInfo }) {
  const [tab, setTab] = useState<"scatter" | "similar" | "import">("scatter");
  const [queryId, setQueryId] = useState<string>("");
  const [neighbors, setNeighbors] = useState<{ id: string | number; score: number; payload?: Record<string, unknown> }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const using = c.named[0];

  async function findSimilar(id: string) {
    setQueryId(id);
    setError(null);
    try {
      setNeighbors((await similarPoints(c.name, { id: /^\d+$/.test(id) ? Number(id) : id, limit: 10, using })).points);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNeighbors([]);
    }
  }

  const tabBtn = (key: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-1.5 ${tab === key ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}>
      {label}
    </button>
  );
  return (
    <section className="flex flex-col gap-3" aria-label={`${c.name} 컬렉션`}>
      <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {tabBtn("scatter", "산점도")}
        {tabBtn("similar", "비슷한 점 찾기")}
        {tabBtn("import", "payload를 표로 불러오기")}
      </nav>
      {tab === "scatter" && <Scatter c={c} using={using} neighbors={neighbors} queryId={queryId} onPick={(id) => void findSimilar(id).then(() => setTab("similar"))} />}
      {tab === "similar" && (
        <div className="flex flex-col gap-2">
          <form
            className="flex items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (queryId.trim()) void findSimilar(queryId.trim());
            }}
          >
            <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="점 id (예: 100001)" aria-label="점 id" className="w-48 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" />
            <button type="submit" className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Search className="size-3.5" aria-hidden />
              비슷한 점 10개
            </button>
            <span className="text-xs text-zinc-500">산점도에서 점을 눌러도 됩니다. 점수는 {c.distance === "Cosine" ? "코사인 유사도(1에 가까울수록 비슷)" : c.distance === "Euclid" ? "거리(작을수록 비슷)" : "벡터 곱(클수록 비슷)"}입니다.</span>
          </form>
          {error && <p className="text-sm text-red-600">찾지 못했습니다. {error}</p>}
          {neighbors && neighbors.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-2 py-1 font-medium">순위</th>
                  <th className="px-2 py-1 font-medium">점 id</th>
                  <th className="px-2 py-1 text-right font-medium">점수</th>
                  <th className="px-2 py-1 font-medium">payload</th>
                </tr>
              </thead>
              <tbody>
                {neighbors.map((n, i) => (
                  <tr key={String(n.id)} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1 font-mono">
                      <button type="button" onClick={() => void findSimilar(String(n.id))} className="text-blue-700 hover:underline dark:text-blue-400" title="이 점과 비슷한 점 찾기">
                        {String(n.id)}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{n.score.toFixed(3)}</td>
                    <td className="px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {Object.entries(flattenPayload(n.payload))
                        .slice(0, 6)
                        .map(([k, v]) => `${k}=${v ?? ""}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === "import" && <ImportPayload c={c} />}
    </section>
  );
}

// 산점도: 점을 최대 N개 읽어 2차원으로 펼친다. payload 필드 하나로 색을 칠한다(많은 3가지, 나머지는 「그 밖」).
function Scatter({ c, using, neighbors, queryId, onPick }: { c: CollectionInfo; using?: string; neighbors: { id: string | number }[] | null; queryId: string; onPick: (id: string) => void }) {
  const [limit, setLimit] = useState(1000);
  const [data, setData] = useState<{ key: string; points: { id: string | number; payload: Record<string, unknown>; xy: [number, number] }[] } | { key: string; error: string } | null>(null);
  const [colorBy, setColorBy] = useState<string>("");
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const key = `${c.name}|${limit}`;
  useEffect(() => {
    let active = true;
    (async () => {
      const pts: QPoint[] = [];
      let offset: unknown;
      while (pts.length < limit) {
        const r = await scrollPoints(c.name, { limit: Math.min(1000, limit - pts.length), offset, vectors: true, using });
        pts.push(...r.points);
        if (!r.next_page_offset) break;
        offset = r.next_page_offset;
      }
      const withVec = pts.map((p) => ({ p, v: vectorOf(p, using) })).filter((x): x is { p: QPoint; v: number[] } => !!x.v);
      const xy = pca2d(withVec.map((x) => x.v));
      return withVec.map((x, i) => ({ id: x.p.id, payload: flattenPayload(x.p.payload), xy: xy[i] }));
    })()
      .then((points) => active && setData({ key, points }))
      .catch((e) => active && setData({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      active = false;
    };
  }, [key, c.name, limit, using]);

  const result = data?.key === key ? data : null;
  if (!result)
    return (
      <p ref={ref} className="inline-flex items-center gap-1 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        점을 읽어 2차원으로 펼치는 중
      </p>
    );
  if ("error" in result) return <p className="text-sm text-red-600">점을 읽지 못했습니다. {result.error}</p>;
  const pts = result.points;
  // 색칠할 수 있는 필드: 값 종류가 2~20개인 필드
  const fields = [...new Set(pts.flatMap((p) => Object.keys(p.payload)))].filter((f) => {
    const n = new Set(pts.map((p) => String(p.payload[f] ?? ""))).size;
    return n >= 2 && n <= 20;
  });
  const field = colorBy && fields.includes(colorBy) ? colorBy : fields[0] ?? "";
  const counts = new Map<string, number>();
  for (const p of pts) counts.set(String(p.payload[field] ?? "(없음)"), (counts.get(String(p.payload[field] ?? "(없음)")) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const colorOf = (p: (typeof pts)[number]) => {
    const i = top.indexOf(String(p.payload[field] ?? "(없음)"));
    return i >= 0 ? SERIES[i] : "var(--viz-other)";
  };
  const xs = pts.map((p) => p.xy[0]);
  const ys = pts.map((p) => p.xy[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const height = 420;
  const pad = 16;
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - 2 * pad);
  const near = new Set((neighbors ?? []).map((n) => String(n.id)));
  const rest = pts.length - top.reduce((n, k) => n + (counts.get(k) ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1">
          <span className="text-xs text-zinc-500">점 수</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="점 수" className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950">
            {[500, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}개까지
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <span className="text-xs text-zinc-500">색으로 나눌 payload</span>
          <select value={field} onChange={(e) => setColorBy(e.target.value)} aria-label="색으로 나눌 payload" className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950">
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        {/* 범례: 색마다 이름과 점 수(색만으로 구분하지 않게) */}
        <ul className="flex flex-wrap items-center gap-3 text-xs" aria-label="범례" style={{ color: "var(--viz-text-secondary)" }}>
          {top.map((k, i) => (
            <li key={k} className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
              {k} {counts.get(k)}
            </li>
          ))}
          {rest > 0 && (
            <li className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full" style={{ background: "var(--viz-other)" }} aria-hidden />
              그 밖 {rest}
            </li>
          )}
        </ul>
        <button type="button" onClick={() => setShowTable(!showTable)} className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
          <Table2 className="size-3.5" aria-hidden />
          {showTable ? "그림으로 보기" : "표로 보기"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        벡터 {pts.length.toLocaleString()}개를 주성분 두 개로 펼쳤습니다. 가까운 점은 비슷한 벡터이고, 축의 값 자체에는 뜻이 없습니다. 점을 누르면 비슷한 점 10개를 찾아 테두리로 표시합니다.
      </p>
      <div ref={ref} className="relative rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {showTable ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-1 font-medium">{field}</th>
                <th className="px-2 py-1 text-right font-medium">점 수</th>
              </tr>
            </thead>
            <tbody>
              {[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <tr key={k} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1">{k}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <svg width={width} height={height} role="img" aria-label={`${c.name} 산점도, 점 ${pts.length}개`}>
            {pts.map((p, i) => {
              const isNear = near.has(String(p.id));
              const isQuery = String(p.id) === queryId;
              return (
                <circle
                  key={String(p.id)}
                  cx={sx(p.xy[0])}
                  cy={sy(p.xy[1])}
                  r={isQuery ? 6 : 4}
                  fill={colorOf(p)}
                  stroke={isQuery || isNear ? "var(--viz-text-primary)" : "var(--background)"}
                  strokeWidth={isQuery || isNear ? 2 : 1.5}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick(String(p.id))}
                  className="cursor-pointer"
                />
              );
            })}
          </svg>
        )}
        {hover !== null && !showTable && (
          <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900" style={{ left: sx(pts[hover].xy[0]), top: sy(pts[hover].xy[1]) - 8, color: "var(--viz-text-primary)" }}>
            <div className="font-mono">id {String(pts[hover].id)}</div>
            {Object.entries(pts[hover].payload)
              .slice(0, 5)
              .map(([k, v]) => (
                <div key={k} style={{ color: "var(--viz-text-secondary)" }}>
                  {k}: {String(v ?? "")}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// payload를 표로 불러오기: 점을 차례로 읽어 펼친 뒤 CSV 파일로 만들어 다른 파일과 같은 길(DuckDB)로 연다.
// 그러면 데이터 보기, 조건 거르기, 차트, 값 찾기, 참조 관계를 그대로 쓸 수 있다.
function ImportPayload({ c }: { c: CollectionInfo }) {
  const { addFile, replaceFile, sources } = useWorkspace();
  const [max, setMax] = useState(Math.min(c.points, 20000));
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<{ rows: number; columns: number } | null>(null);
  const fileName = `qdrant_${c.name}.csv`;
  const existing = sources.find((s) => s.meta.name === fileName);

  async function run() {
    setDone(null);
    const rows: Record<string, unknown>[] = [];
    let offset: unknown;
    try {
      while (rows.length < max) {
        setProgress(`${rows.length.toLocaleString()}/${Math.min(max, c.points).toLocaleString()} 읽는 중`);
        const r = await scrollPoints(c.name, { limit: Math.min(1000, max - rows.length), offset });
        for (const p of r.points) rows.push({ point_id: p.id, ...flattenPayload(p.payload) });
        if (!r.next_page_offset) break;
        offset = r.next_page_offset;
      }
      const columns = ["point_id", ...new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => k !== "point_id"))];
      setProgress("표로 여는 중");
      const file = new File([toCsv(rows, columns)], fileName, { type: "text/csv" });
      // 다시 불러오면 같은 표를 새 판으로 바꾼다(바로 전 판은 패치 전후 비교에 남는다).
      if (existing) await replaceFile(existing.meta.id, file);
      else await addFile(file);
      setDone({ rows: rows.length, columns: columns.length });
      setProgress(null);
    } catch (e) {
      setProgress(`불러오지 못했습니다. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        점의 payload를 한 행씩 펼쳐(안쪽 값은 stats.atk처럼, 목록은 |로 이어) {fileName} 표로 엽니다. 벡터 값은 넣지 않습니다. 불러온 표는 다른 파일처럼 데이터 보기, 조건 거르기, 차트에서 씁니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1">
          <span className="text-xs text-zinc-500">점</span>
          <input type="number" min={1} max={200000} value={max} onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))} aria-label="불러올 점 수" className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" />
          <span className="text-xs text-zinc-500">개까지 (전체 {c.points.toLocaleString()}개)</span>
        </label>
        <button type="button" onClick={() => void run()} disabled={!!progress && !progress.startsWith("불러오지")} className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          <Upload className="size-3.5" aria-hidden />
          {existing ? "다시 불러오기" : "표로 불러오기"}
        </button>
        {progress && <span className="text-xs text-zinc-500">{progress}</span>}
        {(done || existing) && (
          <Link href={existing ? `/sources/${existing.meta.id}` : "/files"} className="text-blue-700 hover:underline dark:text-blue-400">
            {done ? `${done.rows.toLocaleString()}행, 컬럼 ${done.columns}개를 열었습니다. 표 보기` : "불러온 표 보기"}
          </Link>
        )}
      </div>
    </div>
  );
}
