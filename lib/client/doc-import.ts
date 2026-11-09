import JSZip from "jszip";
import * as XLSX from "xlsx";

// 기획서를 "절"로 나눠 읽는다. 워드는 제목 문단, PPT는 슬라이드, PDF는 쪽, 엑셀은 시트가 한 절이다.
// 문서 안의 표는 머리글과 행을 살려 따로 들고 있는다. 불일치 검출이 이 표를 쓴다.
export type DocKind = "docx" | "pptx" | "pdf" | "xlsx";

export interface DocTable {
  header: string[];
  rows: string[][];
}

export interface DocSection {
  id: string; // 문서 안에서 유일한 절 id (s0, s1, ...)
  title: string;
  lines: string[];
  tables: DocTable[];
  path?: string[]; // 제목 경로(1. 개요 > 1.1 과일 데이터 정의). 워드만 있다
  level?: number; // 제목 수준(1~9). 워드만 있다
}

// 원문 창(26단계, 3-8)에 그릴 워드 문서 조각. 서식(굵게), 번호, 글머리표, 합친 칸, 목차, 글상자를 살린다.
export interface DocRun {
  text: string;
  bold?: boolean;
}
export interface DocCell {
  runs: DocRun[];
  span: number; // 가로로 합친 칸 수
  rowSpan?: number; // 세로로 합친 칸 수(36단계). 합친 칸의 첫 칸에만 있다
  merged?: boolean; // 위 칸과 세로로 합쳐진 칸. 원문 창에서 그리지 않는다
}
export type DocBlock =
  | { kind: "heading"; sectionId: string; level: number; label?: string; runs: DocRun[]; style: string }
  | {
      kind: "para";
      sectionId: string;
      runs: DocRun[];
      style: string;
      label?: string; // 번호(1., 가.)나 글머리표(•)
      indent?: number; // 목록 수준(0부터)
      toc?: boolean; // 목차 줄. 흐리게 그린다
      textbox?: boolean; // 글상자 안의 글
      title?: boolean; // 문서 제목 스타일
    }
  | { kind: "table"; sectionId: string; rows: DocCell[][] };

export interface ParsedDoc {
  sections: DocSection[];
  blocks?: DocBlock[]; // 워드만 있다. 없으면 원문 창이 절의 줄과 표로 그린다
}

export function detectDocKind(fileName: string): DocKind | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "docx" || ext === "pptx" || ext === "pdf" || ext === "xlsx") return ext;
  return null;
}

export async function parseDoc(kind: DocKind, file: File): Promise<ParsedDoc> {
  const buffer = await file.arrayBuffer();
  if (kind === "docx") return parseDocx(buffer);
  const sections = kind === "pptx" ? await parsePptx(buffer) : kind === "pdf" ? await parsePdf(buffer) : parseXlsx(buffer);
  return { sections: sections.map((s, i) => ({ ...s, id: `s${i}`, path: [s.title] })) };
}

type RawSection = Omit<DocSection, "id">;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function xml(text: string) {
  return new DOMParser().parseFromString(text, "application/xml");
}

// 요소 아래의 모든 텍스트 조각(w:t, a:t)을 이어 붙인다.
function textOf(el: Element, tag: string) {
  return clean(Array.from(el.getElementsByTagName(tag)).map((t) => t.textContent ?? "").join(""));
}

function tableOf(tbl: Element, rowTag: string, cellTag: string, textTag: string): DocTable | null {
  const rows = Array.from(tbl.getElementsByTagName(rowTag)).map((tr) =>
    Array.from(tr.getElementsByTagName(cellTag)).map((tc) => textOf(tc, textTag)),
  );
  if (rows.length === 0) return null;
  return { header: rows[0], rows: rows.slice(1) };
}

// 워드 읽기. 제목 스타일 문단에서 절을 나누고, 원문 창용 조각(blocks)을 함께 만든다.
// - 제목 수준: styles.xml의 스타일 이름(heading 1, 제목 1)이나 스타일 id(Heading1)
// - 번호: numbering.xml의 번호 형식(1., 가., ①)과 글머리표를 목록마다 세어 붙인다
// - 표: 가로로 합친 칸(gridSpan)을 살린다. 불일치 검출용 표(DocTable)는 합친 칸 뒤를 빈 칸으로 채워 열을 맞춘다
//   세로로 합친 칸(vMerge)은 원문 창에서 한 칸으로 그리고, 불일치 검출용 표에서는 아래 칸마다 위 칸 값을 채운다
//   (「아이템 | 1001」을 세 줄에 걸쳐 합쳐 두면 세 줄 모두 1001의 행으로 본다)
// - 글상자: 문단 안의 글상자 글은 따로 조각으로 둔다. 대체 내용(mc:Fallback)은 같은 글이 두 번 나오므로 뺀다
// - 지운 글자(w:delText)는 읽지 않는다
async function parseDocx(buffer: ArrayBuffer): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buffer);
  const doc = xml(await zip.file("word/document.xml")!.async("string"));
  const styles = await readStyles(zip);
  const numbering = await readNumbering(zip);
  const counters = new Map<string, number[]>();
  const body = doc.getElementsByTagName("w:body")[0];

  const raw: (RawSection & { level: number })[] = [{ title: "머리말", lines: [], tables: [], level: 0, path: [] }];
  const blocks: (DocBlock & { raw: number })[] = [];
  const stack: { level: number; title: string }[] = [];

  for (const node of Array.from(body?.children ?? [])) {
    const index = raw.length - 1;
    const current = raw[index];
    if (node.tagName === "w:p") {
      const runs = runsOf(node);
      const text = clean(runs.map((r) => r.text).join(""));
      const styleId = node.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") ?? "";
      const styleName = styles.get(styleId) ?? styleId;
      const level = headingLevel(styleId, styleName);
      const label = numberLabel(node, numbering, counters);
      if (text && level) {
        // 제목 스타일을 만나면 새 절을 시작한다. 제목 경로는 더 높은 수준의 제목들이다.
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const title = label && !text.startsWith(label.trim()) ? `${label} ${text}` : text;
        stack.push({ level, title });
        raw.push({ title, lines: [], tables: [], level, path: stack.map((h) => h.title) });
        blocks.push({ kind: "heading", raw: raw.length - 1, sectionId: "", level, label, runs, style: styleName });
      } else if (text) {
        current.lines.push(label && !/^[•●○■◆▪\-]$/.test(label.trim()) ? `${label} ${text}` : text);
        const toc = /^(toc|목차)\s*\d/i.test(styleName) || /^toc\d/i.test(styleId);
        blocks.push({
          kind: "para",
          raw: index,
          sectionId: "",
          runs,
          style: styleName,
          ...(label ? { label, indent: Number(node.getElementsByTagName("w:ilvl")[0]?.getAttribute("w:val") ?? 0) } : {}),
          ...(toc ? { toc } : {}),
          ...(/^(title|제목)$/i.test(styleName) ? { title: true } : {}),
        });
      }
      // 글상자 안의 문단. 본문 줄에도 넣어 찾기와 설명에 쓰인다.
      for (const box of textboxesOf(node)) {
        for (const p of Array.from(box.getElementsByTagName("w:p"))) {
          const boxRuns = runsOf(p, true);
          const boxText = clean(boxRuns.map((r) => r.text).join(""));
          if (!boxText) continue;
          current.lines.push(boxText);
          blocks.push({ kind: "para", raw: index, sectionId: "", runs: boxRuns, style: "글상자", textbox: true });
        }
      }
    } else if (node.tagName === "w:tbl") {
      const rows = Array.from(node.getElementsByTagName("w:tr"))
        .filter((tr) => !hasAncestor(tr, "w:txbxContent"))
        .map((tr) =>
          Array.from(tr.children)
            .filter((tc) => tc.tagName === "w:tc")
            .map((tc): DocCell & { vMerge?: "restart" | "continue" } => {
              const vMerge = tc.getElementsByTagName("w:tcPr")[0]?.getElementsByTagName("w:vMerge")[0];
              return {
                runs: Array.from(tc.getElementsByTagName("w:p")).flatMap((p, i) => [...(i ? [{ text: " " }] : []), ...runsOf(p)]),
                span: Number(tc.getElementsByTagName("w:gridSpan")[0]?.getAttribute("w:val") ?? 1) || 1,
                ...(vMerge ? { vMerge: vMerge.getAttribute("w:val") === "restart" ? "restart" : "continue" } : {}),
              };
            }),
        );
      if (!rows.length) continue;
      // 세로 합침: 칸의 격자 위치(앞 칸들의 가로 합침 수를 더한 값)로 위 줄의 같은 자리 칸을 찾는다.
      const starts = new Map<number, DocCell>(); // 격자 위치 → 지금 이어지는 합친 칸의 첫 칸
      const above = new Map<number, string>(); // 격자 위치 → 합친 칸의 글(불일치 검출용 표에 채운다)
      const flat = rows.map((row, r) => {
        let col = 0;
        const out: string[] = [];
        for (const cell of row) {
          const text = clean(cell.runs.map((x) => x.text).join(""));
          if (cell.vMerge === "continue" && starts.has(col)) {
            starts.get(col)!.rowSpan = (starts.get(col)!.rowSpan ?? 1) + 1;
            cell.merged = true;
            out.push(above.get(col) ?? "", ...Array(cell.span - 1).fill(""));
          } else {
            if (cell.vMerge === "restart") {
              starts.set(col, cell);
              // 머리글 줄을 합친 칸(두 줄 머리글)은 아래 줄에 채우지 않는다. 데이터 줄로 잘못 읽힌다.
              if (r > 0) above.set(col, text);
              else above.delete(col);
            } else {
              starts.delete(col);
              above.delete(col);
            }
            out.push(text, ...Array(cell.span - 1).fill(""));
          }
          delete cell.vMerge;
          col += cell.span;
        }
        return out;
      });
      blocks.push({ kind: "table", raw: index, sectionId: "", rows });
      current.tables.push({ header: flat[0], rows: flat.slice(1) });
    }
  }

  // 빈 머리말 절은 뺀다. 절 id는 남은 절 차례로 붙인다.
  const keep = raw.map((s, i) => ({ s, i })).filter(({ s }) => s.lines.length || s.tables.length || s.title !== "머리말");
  const idOf = new Map(keep.map(({ i }, n) => [i, `s${n}`]));
  return {
    sections: keep.map(({ s }, n) => ({ id: `s${n}`, title: s.title, lines: s.lines, tables: s.tables, path: s.path, level: s.level })),
    blocks: blocks.map(({ raw: r, ...b }) => ({ ...b, sectionId: idOf.get(r) ?? "s0" }) as DocBlock),
  };
}

// 문단의 글자 조각. 글상자 안 글과 지운 글자는 뺀다(inBox면 글상자 안을 읽는 중이라 글상자를 빼지 않는다).
function runsOf(p: Element, inBox = false): DocRun[] {
  const runs: DocRun[] = [];
  for (const r of Array.from(p.getElementsByTagName("w:r"))) {
    if (hasAncestor(r, "w:del") || hasAncestor(r, "mc:Fallback")) continue;
    if (!inBox && hasAncestor(r, "w:txbxContent")) continue;
    let text = "";
    for (const c of Array.from(r.children)) {
      if (c.tagName === "w:t") text += c.textContent ?? "";
      else if (c.tagName === "w:tab") text += "\t";
      else if (c.tagName === "w:br") text += " ";
    }
    if (!text) continue;
    const b = r.getElementsByTagName("w:rPr")[0]?.getElementsByTagName("w:b")[0];
    const bold = !!b && !/^(0|false|off)$/i.test(b.getAttribute("w:val") ?? "");
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold) last.text += text;
    else runs.push(bold ? { text, bold } : { text });
  }
  return runs;
}

// 문단 안의 글상자. 대체 내용(mc:Fallback) 쪽은 같은 글상자라 뺀다.
function textboxesOf(p: Element) {
  return Array.from(p.getElementsByTagName("w:txbxContent")).filter((b) => !hasAncestor(b, "mc:Fallback") && !hasAncestor(b.parentElement!, "w:txbxContent"));
}

async function readStyles(zip: JSZip) {
  const map = new Map<string, string>();
  const file = zip.file("word/styles.xml");
  if (!file) return map;
  const doc = xml(await file.async("string"));
  for (const st of Array.from(doc.getElementsByTagName("w:style"))) {
    const id = st.getAttribute("w:styleId");
    const name = st.getElementsByTagName("w:name")[0]?.getAttribute("w:val");
    if (id && name) map.set(id, name);
  }
  return map;
}

// 제목 수준. heading 1, 제목 1, Heading1, 개요 1 꼴. 제목이 아니면 0.
function headingLevel(id: string, name: string) {
  for (const s of [name, id]) {
    const m = s.match(/^(?:heading|제목|개요)\s*(\d)$/i);
    if (m) return Number(m[1]);
  }
  return 0;
}

interface NumLevel {
  fmt: string;
  text: string;
  start: number;
}

async function readNumbering(zip: JSZip) {
  const nums = new Map<string, NumLevel[]>();
  const file = zip.file("word/numbering.xml");
  if (!file) return nums;
  const doc = xml(await file.async("string"));
  const abstract = new Map<string, NumLevel[]>();
  for (const a of Array.from(doc.getElementsByTagName("w:abstractNum"))) {
    const levels: NumLevel[] = [];
    for (const lvl of Array.from(a.getElementsByTagName("w:lvl"))) {
      const i = Number(lvl.getAttribute("w:ilvl") ?? 0);
      levels[i] = {
        fmt: lvl.getElementsByTagName("w:numFmt")[0]?.getAttribute("w:val") ?? "decimal",
        text: lvl.getElementsByTagName("w:lvlText")[0]?.getAttribute("w:val") ?? "",
        start: Number(lvl.getElementsByTagName("w:start")[0]?.getAttribute("w:val") ?? 1),
      };
    }
    abstract.set(a.getAttribute("w:abstractNumId") ?? "", levels);
  }
  for (const n of Array.from(doc.getElementsByTagName("w:num"))) {
    const aid = n.getElementsByTagName("w:abstractNumId")[0]?.getAttribute("w:val") ?? "";
    nums.set(n.getAttribute("w:numId") ?? "", abstract.get(aid) ?? []);
  }
  return nums;
}

const GANADA = "가나다라마바사아자차카타파하";
const CHOSUNG = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
function formatNumber(n: number, fmt: string) {
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    for (const [v, s] of t) {
      while (x >= v) {
        out += s;
        x -= v;
      }
    }
    return out;
  };
  switch (fmt) {
    case "lowerLetter":
      return String.fromCharCode(96 + (((n - 1) % 26) + 1));
    case "upperLetter":
      return String.fromCharCode(64 + (((n - 1) % 26) + 1));
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "ganada":
    case "koreanDigital":
      return GANADA[(n - 1) % GANADA.length];
    case "chosung":
      return CHOSUNG[(n - 1) % CHOSUNG.length];
    case "decimalEnclosedCircle":
      return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    default:
      return String(n);
  }
}

// 문단의 번호. 목록(numId)마다 수준별로 센다. 윗 수준 번호가 오르면 아래 수준은 처음부터.
function numberLabel(p: Element, nums: Map<string, NumLevel[]>, counters: Map<string, number[]>) {
  const numPr = p.getElementsByTagName("w:numPr")[0];
  if (!numPr) return undefined;
  const numId = numPr.getElementsByTagName("w:numId")[0]?.getAttribute("w:val") ?? "";
  const ilvl = Number(numPr.getElementsByTagName("w:ilvl")[0]?.getAttribute("w:val") ?? 0);
  const levels = nums.get(numId);
  const lvl = levels?.[ilvl];
  if (!lvl || numId === "0") return undefined;
  if (lvl.fmt === "bullet") return /^[\uF000-\uF0FF]$/.test(lvl.text) || !lvl.text ? "•" : lvl.text;
  if (lvl.fmt === "none") return undefined;
  const count = counters.get(numId) ?? [];
  for (let i = 0; i <= ilvl; i++) if (count[i] === undefined) count[i] = (levels[i]?.start ?? 1) - 1;
  count[ilvl] += 1;
  count.length = ilvl + 1;
  counters.set(numId, count);
  return lvl.text.replace(/%(\d)/g, (_, d) => formatNumber(count[Number(d) - 1] ?? 1, levels[Number(d) - 1]?.fmt ?? "decimal"));
}

async function parsePptx(buffer: ArrayBuffer): Promise<RawSection[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const sections: RawSection[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const doc = xml(await zip.file(name)!.async("string"));
    const tables = Array.from(doc.getElementsByTagName("a:tbl"))
      .map((tbl) => tableOf(tbl, "a:tr", "a:tc", "a:t"))
      .filter((t): t is DocTable => t !== null);
    // 표 안의 문단은 표로만 다루고 본문 줄에서는 뺀다.
    const lines = Array.from(doc.getElementsByTagName("a:p"))
      .filter((p) => !hasAncestor(p, "a:tbl"))
      .map((p) => textOf(p, "a:t"))
      .filter(Boolean);
    sections.push({ title: lines[0] ?? `슬라이드 ${i + 1}`, lines: lines.slice(1), tables });
  }
  return sections;
}

function hasAncestor(el: Element, tag: string) {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === tag) return true;
  return false;
}

async function parsePdf(buffer: ArrayBuffer): Promise<RawSection[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const sections: RawSection[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    // 글자 조각을 같은 높이끼리 묶어 줄로 만든다. 위에서 아래, 왼쪽에서 오른쪽 순서.
    const byLine = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!byLine.has(y)) byLine.set(y, []);
      byLine.get(y)!.push({ x: item.transform[4], str: item.str });
    }
    const lines = [...byLine.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => clean(parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ")))
      .filter(Boolean);
    sections.push({ title: lines[0] ?? `${n}쪽`, lines: lines.slice(1), tables: [] });
  }
  return sections;
}

function parseXlsx(buffer: ArrayBuffer): RawSection[] {
  const book = XLSX.read(buffer, { dense: true });
  return book.SheetNames.map((name) => {
    const aoa = XLSX.utils
      .sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false })
      .map((row) => row.map((v) => clean(String(v ?? ""))));
    // 첫 줄이 두 칸 이상 다 채워져 있고 아래로 행이 이어지면 표로 본다. 아니면 서술 문장으로 본다.
    const looksTable = aoa.length >= 2 && aoa[0].filter(Boolean).length >= 2 && aoa[0].every(Boolean);
    if (looksTable) return { title: name, lines: [], tables: [{ header: aoa[0], rows: aoa.slice(1) }] };
    return { title: name, lines: aoa.map((row) => row.filter(Boolean).join(" ")).filter(Boolean), tables: [] };
  });
}
