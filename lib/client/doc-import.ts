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
}

export interface ParsedDoc {
  sections: DocSection[];
}

export function detectDocKind(fileName: string): DocKind | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "docx" || ext === "pptx" || ext === "pdf" || ext === "xlsx") return ext;
  return null;
}

export async function parseDoc(kind: DocKind, file: File): Promise<ParsedDoc> {
  const buffer = await file.arrayBuffer();
  const sections =
    kind === "docx" ? await parseDocx(buffer) : kind === "pptx" ? await parsePptx(buffer) : kind === "pdf" ? await parsePdf(buffer) : parseXlsx(buffer);
  return { sections: sections.map((s, i) => ({ ...s, id: `s${i}` })) };
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

async function parseDocx(buffer: ArrayBuffer): Promise<RawSection[]> {
  const zip = await JSZip.loadAsync(buffer);
  const doc = xml(await zip.file("word/document.xml")!.async("string"));
  const body = doc.getElementsByTagName("w:body")[0];
  const sections: RawSection[] = [{ title: "머리말", lines: [], tables: [] }];
  for (const node of Array.from(body?.children ?? [])) {
    const current = sections[sections.length - 1];
    if (node.tagName === "w:p") {
      const text = textOf(node, "w:t");
      if (!text) continue;
      const style = node.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") ?? "";
      // 제목 스타일(Heading1, 제목 1 등)을 만나면 새 절을 시작한다.
      if (/^(heading|제목)/i.test(style)) sections.push({ title: text, lines: [], tables: [] });
      else current.lines.push(text);
    } else if (node.tagName === "w:tbl") {
      const table = tableOf(node, "w:tr", "w:tc", "w:t");
      if (table) current.tables.push(table);
    }
  }
  return sections.filter((s) => s.lines.length || s.tables.length || s.title !== "머리말");
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
