// 열어 둔 파일 원본과 목록, 관계 설정을 OPFS(Origin Private File System)에 보관한다.
// 새로고침 후에도 파일을 다시 고를 필요가 없게 하려는 목적.

export type FileKind = "csv" | "excel";

export interface FileSourceMeta {
  id: string;
  name: string;
  fileName: string;
  kind: FileKind;
  header: boolean;
  createdAt: string;
  replacedAt?: string;
  originPath?: string; // 경로를 지정해서 연 파일이면 그 경로. "원본 경로에서 다시 읽기"에 쓴다.
}

// 데이터베이스 소스. 접속 정보는 서버에 있고 여기에는 연결 id만 둔다.
export interface DbSourceMeta {
  id: string;
  name: string;
  kind: "mysql";
  connectionId: string;
  database: string;
  createdAt: string;
  loadedAt?: string; // 마지막으로 불러온 시각
}

export type SourceMeta = FileSourceMeta | DbSourceMeta;

export function isFileSource(meta: SourceMeta): meta is FileSourceMeta {
  return meta.kind !== "mysql";
}

const MANIFEST = "sources.json";
const RELATIONS = "relations.json";
const DIAGRAM = "diagram.json";
const FILES_DIR = "files";

async function filesDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FILES_DIR, { create: true });
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  const root = await navigator.storage.getDirectory();
  try {
    const handle = await root.getFileHandle(name);
    const text = await (await handle.getFile()).text();
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return fallback;
    throw e;
  }
}

async function writeJson(name: string, value: unknown) {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value));
  await writable.close();
}

export function readManifest() {
  return readJson<SourceMeta[]>(MANIFEST, []);
}

export function writeManifest(list: SourceMeta[]) {
  return writeJson(MANIFEST, list);
}

export function readRelationsFile<T>() {
  return readJson<T[]>(RELATIONS, []);
}

export function writeRelationsFile<T>(list: T[]) {
  return writeJson(RELATIONS, list);
}

// 기획서. 데이터 소스와 따로 목록(documents.json)과 원본 폴더(docs/)를 둔다.
export interface DocMeta {
  id: string;
  name: string;
  fileName: string;
  kind: "docx" | "pptx" | "pdf" | "xlsx";
  createdAt: string;
  replacedAt?: string;
  originPath?: string;
}

const DOCUMENTS = "documents.json";
const DOCS_DIR = "docs";
const DOC_MAPPINGS = "doc-mappings.json";
const GLOSSARY = "glossary.json";

export const readDocuments = () => readJson<DocMeta[]>(DOCUMENTS, []);
export const writeDocuments = (list: DocMeta[]) => writeJson(DOCUMENTS, list);
export const readDocMappingsFile = <T>() => readJson<T[]>(DOC_MAPPINGS, []);
export const writeDocMappingsFile = <T>(list: T[]) => writeJson(DOC_MAPPINGS, list);
export const readGlossaryFile = () => readJson<string | null>(GLOSSARY, null);
export const writeGlossaryFile = (text: string) => writeJson(GLOSSARY, text);

async function docsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DOCS_DIR, { create: true });
}

export async function saveDocFile(id: string, file: File) {
  const dir = await (await docsDir()).getDirectoryHandle(id, { create: true });
  const writable = await (await dir.getFileHandle(file.name, { create: true })).createWritable();
  await writable.write(file);
  await writable.close();
}

export async function readDocFile(meta: DocMeta): Promise<File> {
  const dir = await (await docsDir()).getDirectoryHandle(meta.id);
  return (await dir.getFileHandle(meta.fileName)).getFile();
}

export async function deleteDocFile(id: string) {
  await (await docsDir()).removeEntry(id, { recursive: true }).catch(() => {});
}

export type DiagramLayout = Record<string, { x: number; y: number }>;

export function readDiagramLayout() {
  return readJson<DiagramLayout>(DIAGRAM, {});
}

export function writeDiagramLayout(layout: DiagramLayout) {
  return writeJson(DIAGRAM, layout);
}

export async function saveFile(id: string, file: File) {
  const dir = await (await filesDir()).getDirectoryHandle(id, { create: true });
  const handle = await dir.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
}

// 새 파일을 먼저 저장한 뒤 이름이 다른 옛 파일을 지운다. 저장이 실패해도 원본은 남는다.
export async function replaceFile(meta: FileSourceMeta, file: File) {
  await saveFile(meta.id, file);
  if (meta.fileName !== file.name) {
    const dir = await (await filesDir()).getDirectoryHandle(meta.id);
    await dir.removeEntry(meta.fileName).catch(() => {});
  }
}

export async function readFile(meta: FileSourceMeta): Promise<File> {
  const dir = await (await filesDir()).getDirectoryHandle(meta.id);
  const handle = await dir.getFileHandle(meta.fileName);
  return handle.getFile();
}

export async function deleteFile(id: string) {
  try {
    await (await filesDir()).removeEntry(id, { recursive: true });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
  }
}

// 도메인 지도에서 사용자가 바꾼 테이블의 도메인. 테이블 키(소스 id/테이블) → 도메인 이름.
const DOMAINS = "domains.json";
export const readDomainOverrides = () => readJson<Record<string, string>>(DOMAINS, {});
export const writeDomainOverrides = (value: Record<string, string>) => writeJson(DOMAINS, value);
