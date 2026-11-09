// 근거 복사(PLAN.md 29단계, 5-1). QA가 버그 보고나 TC에 붙여 넣을 글을 정해 둔 꼴로 만든다.
// 모든 근거는 「[근거] 종류 · 무엇」 첫 줄과 「이름: 내용」 줄로 이루어진다. 회사 시스템에 그대로 붙여도 읽히도록 꾸밈 글자를 쓰지 않는다.

export interface TableLabel {
  table: string; // 영어 이름
  korean?: string | null; // 한글 이름
  sourceName?: string | null; // 파일 이름(또는 DB 이름)
}

const name = (t: TableLabel) => (t.korean ? `${t.korean}(${t.table})` : t.table);
const where = (t: TableLabel) => (t.sourceName ? `${t.sourceName} / ${t.table}` : t.table);
const clean = (v: unknown) => (v === null || v === undefined || v === "" ? "(비어 있음)" : String(v).replace(/^(-?\d+)\.0+$/, "$1"));

export function rowEvidence(t: TableLabel, idColumn: string, idValue: string, values: Record<string, unknown> | null, opts: { inactive?: boolean; title?: string | null } = {}) {
  const lines = [`[근거] 행 · ${name(t)} ${idColumn} ${idValue}`, `위치: ${where(t)}`];
  if (opts.title) lines.push(`이름: ${opts.title}`);
  if (opts.inactive) lines.push("상태: 비활성 행(엑셀에서 Id 앞에 ;로 막음)");
  if (!values) lines.push("값: 데이터에 이 ID의 행이 없음");
  else lines.push(`값: ${Object.entries(values).map(([k, v]) => `${k}=${clean(v)}`).join(", ")}`);
  return lines.join("\n");
}

export function columnEvidence(
  t: TableLabel,
  column: string,
  info: { type?: string; description?: { text: string; from: "design" | "definition" } | null; targets?: string[]; referrers?: string[]; examples?: string[] },
) {
  const lines = [`[근거] 컬럼 · ${name(t)}.${column}`, `위치: ${where(t)}`];
  if (info.type) lines.push(`종류: ${info.type}`);
  if (info.description) lines.push(`${info.description.from === "design" ? "설명(#Design)" : "정의(#Definition)"}: ${info.description.text}`);
  if (info.targets?.length) lines.push(`참조 대상: ${info.targets.join(", ")}`);
  if (info.referrers?.length) lines.push(`참조하는 곳: ${info.referrers.join(", ")}`);
  if (info.examples?.length) lines.push(`값 예시: ${info.examples.join(", ")}`);
  return lines.join("\n");
}

export function docEvidence(docName: string, path: string[], sentence: string, about?: string) {
  const lines = [`[근거] 기획서 · ${docName} › ${path.join(" › ")}`, `문장: ${sentence}`];
  if (about) lines.push(`관련 테이블: ${about}`);
  return lines.join("\n");
}

// 클립보드에 쓴다. 보안 문맥이 아니라 navigator.clipboard가 없으면 숨긴 글 칸으로 복사한다.
export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 방법으로 다시 해 본다.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}
