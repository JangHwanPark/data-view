"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DbRequestError, dbErrorText, loadDbIntoDuckDB, requestJson, snapshotDb } from "@/lib/client/db-import";
import { detectKind, dropSource, loadIntoDuckDB } from "@/lib/client/file-import";
import { fetchLocalFile } from "@/lib/client/local-files";
import { detectDocKind, parseDoc, type ParsedDoc } from "@/lib/client/doc-import";
import { DEFAULT_GLOSSARY, type DocMapping } from "@/lib/client/doc-infer";
import {
  deleteDocFile,
  deleteFile,
  isFileSource,
  readDocFile,
  readDocMappingsFile,
  readDocuments,
  readGlossaryFile,
  saveDocFile,
  writeDocMappingsFile,
  writeDocuments,
  writeGlossaryFile,
  type DocMeta,
  readFile,
  readManifest,
  readRelationsFile,
  replaceFile as replaceStoredFile,
  savePreviousFile,
  saveFile,
  writeManifest,
  writeRelationsFile,
  type DbSourceMeta,
  type FileSourceMeta,
  type SourceMeta,
} from "@/lib/client/opfs";
import type { Relation } from "@/lib/client/relations";

export type SourceStatus = "loading" | "ready" | "error";

// 파일과 DB를 같은 모양으로 다룬다. 둘 다 DuckDB의 소스별 스키마에 테이블로 올라간다.
export interface WorkspaceSource {
  meta: SourceMeta;
  status: SourceStatus;
  tables: string[];
  truncated?: string[]; // DB에서 행 수 제한에 걸린 테이블
  error?: string; // 화면에 보여줄 문구
  errorDetail?: string; // 원문
}

export interface NewDatabaseSource {
  connectionId: string;
  name: string;
  database: string;
}

export interface WorkspaceDoc {
  meta: DocMeta;
  status: SourceStatus;
  parsed?: ParsedDoc;
  error?: string;
}

interface WorkspaceValue {
  sources: WorkspaceSource[];
  relations: Relation[];
  docs: WorkspaceDoc[];
  mappings: DocMapping[];
  glossary: string;
  addDocument: (file: File, originPath?: string) => Promise<string>;
  replaceDocument: (id: string, file: File) => Promise<void>;
  reloadFromOrigin: (id: string) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  setMapping: (mapping: DocMapping) => Promise<void>;
  clearMapping: (key: string) => Promise<void>;
  setGlossary: (text: string) => Promise<void>;
  initialized: boolean;
  initError: string | null;
  addFile: (file: File, originPath?: string) => Promise<string>;
  addDatabase: (input: NewDatabaseSource) => Promise<string>;
  reloadSource: (id: string) => Promise<void>;
  keepDbBaseline: (id: string) => Promise<void>;
  replaceFile: (id: string, file: File) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  setHeader: (id: string, header: boolean) => Promise<void>;
  addRelations: (relations: Relation[]) => Promise<void>;
  removeRelation: (id: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

// 개발 모드에서 effect가 두 번 실행돼도 복원은 한 번만 하도록 모듈 단위로 묶는다.
let restorePromise: Promise<[SourceMeta[], Relation[], DocMeta[], DocMapping[], string | null]> | null = null;

function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [docs, setDocs] = useState<WorkspaceDoc[]>([]);
  const [mappings, setMappings] = useState<DocMapping[]>([]);
  const [glossary, setGlossaryState] = useState(DEFAULT_GLOSSARY);

  function updateDoc(id: string, patch: Partial<WorkspaceDoc>) {
    setDocs((prev) => prev.map((d) => (d.meta.id === id ? { ...d, ...patch } : d)));
  }

  async function loadDoc(meta: DocMeta, file?: File) {
    updateDoc(meta.id, { status: "loading", error: undefined });
    try {
      const parsed = await parseDoc(meta.kind, file ?? (await readDocFile(meta)));
      updateDoc(meta.id, { status: "ready", parsed });
    } catch (e) {
      updateDoc(meta.id, { status: "error", error: errorMessage(e) });
    }
  }

  function update(id: string, patch: Partial<WorkspaceSource>) {
    setSources((prev) => prev.map((s) => (s.meta.id === id ? { ...s, ...patch } : s)));
  }

  async function load(meta: SourceMeta, file?: File) {
    update(meta.id, { status: "loading", error: undefined, errorDetail: undefined });
    try {
      if (isFileSource(meta)) {
        const tables = await loadIntoDuckDB(meta, file ?? (await readFile(meta)));
        update(meta.id, { status: "ready", tables });
      } else {
        const { tables, truncated } = await loadDbIntoDuckDB(meta);
        const loaded = { ...meta, loadedAt: new Date().toISOString() };
        await editManifest((list) => list.map((m) => (m.id === meta.id ? loaded : m)));
        update(meta.id, { status: "ready", tables, truncated, meta: loaded });
      }
    } catch (e) {
      const isDb = !isFileSource(meta);
      update(meta.id, {
        status: "error",
        tables: [],
        error: e instanceof DbRequestError ? dbErrorText(e.code) : isDb ? dbErrorText("") : "파일을 읽지 못했습니다. 파일 형식이 올바른지 확인해 주세요.",
        errorDetail: errorMessage(e),
      });
    }
  }

  useEffect(() => {
    let active = true;
    restorePromise ??= Promise.all([
      readManifest(),
      readRelationsFile<Relation>(),
      readDocuments(),
      readDocMappingsFile<DocMapping>(),
      readGlossaryFile(),
    ]);
    restorePromise
      .then(async ([list, savedRelations, docList, savedMappings, savedGlossary]) => {
        if (!active) return;
        setSources(list.map((meta) => ({ meta, status: "loading", tables: [] })));
        setRelations(savedRelations);
        setDocs(docList.map((meta) => ({ meta, status: "loading" })));
        setMappings(savedMappings);
        if (savedGlossary) setGlossaryState(savedGlossary);
        setInitialized(true);
        // 기획서는 가벼워서 먼저 읽고, 데이터는 그다음에 하나씩 적재한다.
        for (const meta of docList) {
          if (!active) return;
          await loadDoc(meta);
        }
        for (const meta of list) {
          if (!active) return;
          await load(meta);
        }
      })
      .catch((e) => {
        if (!active) return;
        setInitError(errorMessage(e));
        setInitialized(true);
      });
    return () => {
      active = false;
    };
    // 최초 한 번만 복원한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 목록은 렌더 시점의 state가 아니라 저장된 목록을 기준으로 고친다.
  // 연달아 바꿀 때 앞의 변경이 덮이지 않게 하려는 목적.
  async function editManifest(edit: (list: SourceMeta[]) => SourceMeta[]) {
    await writeManifest(edit(await readManifest()));
  }

  async function editRelations(edit: (list: Relation[]) => Relation[]) {
    const next = edit(await readRelationsFile<Relation>());
    await writeRelationsFile(next);
    setRelations(next);
  }

  async function addFile(file: File, originPath?: string) {
    const kind = detectKind(file.name);
    if (!kind) throw new Error("CSV, XLSX, XLS 파일만 열 수 있습니다.");

    const meta: FileSourceMeta = {
      id: newId(),
      name: file.name,
      fileName: file.name,
      kind,
      header: true,
      createdAt: new Date().toISOString(),
      ...(originPath ? { originPath } : {}),
    };
    await saveFile(meta.id, file);
    await editManifest((list) => [...list, meta]);
    setSources((prev) => [...prev, { meta, status: "loading", tables: [] }]);
    void load(meta, file);
    return meta.id;
  }

  async function addDatabase(input: NewDatabaseSource) {
    const meta: DbSourceMeta = { id: newId(), kind: "mysql", createdAt: new Date().toISOString(), ...input };
    await editManifest((list) => [...list, meta]);
    setSources((prev) => [...prev, { meta, status: "loading", tables: [] }]);
    void load(meta);
    return meta.id;
  }

  // DB는 다시 불러오기 직전 상태를 이전 상태로 남겨 패치 전후 비교에 쓴다(37단계). 남기지 못해도 다시 불러온다.
  async function reloadSource(id: string) {
    const target = sources.find((s) => s.meta.id === id);
    if (!target) return;
    if (isFileSource(target.meta) || target.status !== "ready") return load(target.meta);
    const meta = await keepSnapshot(target.meta, target.tables).catch(() => target.meta);
    await load(meta);
  }

  // 지금 불러온 DB 상태를 비교 기준으로 남긴다. 패치를 올리기 전에 눌러 두면, 앱을 다시 열어도 그 상태와 비교할 수 있다.
  async function keepDbBaseline(id: string) {
    const target = sources.find((s) => s.meta.id === id);
    if (!target || isFileSource(target.meta) || target.status !== "ready") return;
    await keepSnapshot(target.meta, target.tables);
  }

  async function keepSnapshot(current: DbSourceMeta, tables: string[]) {
    const previous = await snapshotDb(current, tables);
    const meta: DbSourceMeta = { ...current, previous };
    await editManifest((list) => list.map((m) => (m.id === current.id ? meta : m)));
    update(current.id, { meta });
    return meta;
  }

  // 소스 id와 이름은 그대로 두고 원본만 바꾼다. 관계가 소스 id와 테이블 이름으로 대상을 가리키기 때문.
  async function replaceFile(id: string, file: File) {
    const target = sources.find((s) => s.meta.id === id);
    if (!target || !isFileSource(target.meta)) return;
    if (detectKind(file.name) !== target.meta.kind) {
      throw new Error(target.meta.kind === "excel" ? "엑셀 파일로만 교체할 수 있습니다." : "CSV 파일로만 교체할 수 있습니다.");
    }
    // 패치 전후 비교(설계 4.9)를 위해 지금 파일을 이전 파일로 한 벌 남긴다. 남기지 못해도 교체는 한다.
    const current = target.meta;
    const previous = await savePreviousFile(current).catch(() => current.previous);
    await replaceStoredFile(target.meta, file);
    const meta: FileSourceMeta = { ...target.meta, fileName: file.name, replacedAt: new Date().toISOString(), ...(previous ? { previous } : {}) };
    await editManifest((list) => list.map((m) => (m.id === id ? meta : m)));
    update(id, { meta });
    await load(meta, file);
  }

  async function removeSource(id: string) {
    const target = sources.find((s) => s.meta.id === id);
    await editManifest((list) => list.filter((m) => m.id !== id));
    await editRelations((list) => list.filter((r) => r.from.sourceId !== id && r.to.sourceId !== id));
    setSources((prev) => prev.filter((s) => s.meta.id !== id));
    await deleteFile(id);
    await dropSource(id);
    // DB 소스면 다른 소스가 쓰지 않는 접속 정보도 서버에서 지운다.
    if (target && !isFileSource(target.meta)) {
      const connectionId = target.meta.connectionId;
      const stillUsed = sources.some((s) => s.meta.id !== id && !isFileSource(s.meta) && s.meta.connectionId === connectionId);
      if (!stillUsed) await requestJson(`/api/connections/${connectionId}`, { method: "DELETE" }).catch(() => {});
    }
  }

  async function setHeader(id: string, header: boolean) {
    const target = sources.find((s) => s.meta.id === id);
    if (!target || !isFileSource(target.meta)) return;
    const meta: FileSourceMeta = { ...target.meta, header };
    await editManifest((list) => list.map((m) => (m.id === id ? meta : m)));
    update(id, { meta });
    await load(meta);
  }

  async function addDocument(file: File, originPath?: string) {
    const kind = detectDocKind(file.name);
    if (!kind) throw new Error("워드(docx), PPT(pptx), PDF, 엑셀(xlsx) 기획서만 열 수 있습니다.");
    const meta: DocMeta = {
      id: newId(),
      name: file.name,
      fileName: file.name,
      kind,
      createdAt: new Date().toISOString(),
      ...(originPath ? { originPath } : {}),
    };
    await saveDocFile(meta.id, file);
    await writeDocuments([...(await readDocuments()), meta]);
    setDocs((prev) => [...prev, { meta, status: "loading" }]);
    void loadDoc(meta, file);
    return meta.id;
  }

  // 같은 기획서의 새 판. 확정한 매칭은 용어 키에 묶여 있어서 그대로 이어진다.
  async function replaceDocument(id: string, file: File) {
    const target = docs.find((d) => d.meta.id === id);
    if (!target) return;
    const kind = detectDocKind(file.name);
    if (!kind) throw new Error("워드(docx), PPT(pptx), PDF, 엑셀(xlsx) 기획서만 열 수 있습니다.");
    await deleteDocFile(id);
    await saveDocFile(id, file);
    const meta: DocMeta = { ...target.meta, fileName: file.name, kind, replacedAt: new Date().toISOString() };
    await writeDocuments((await readDocuments()).map((d) => (d.id === id ? meta : d)));
    updateDoc(id, { meta });
    await loadDoc(meta, file);
  }

  // 경로를 지정해서 연 파일과 기획서는 같은 경로에서 다시 읽어 교체한다. 갱신본이 같은 자리에 덮어써지는 경우를 위해서다.
  async function reloadFromOrigin(id: string) {
    const source = sources.find((s) => s.meta.id === id);
    if (source && isFileSource(source.meta) && source.meta.originPath) {
      await replaceFile(id, await fetchLocalFile(source.meta.originPath));
      return;
    }
    const doc = docs.find((d) => d.meta.id === id);
    if (doc?.meta.originPath) await replaceDocument(id, await fetchLocalFile(doc.meta.originPath));
  }

  async function removeDocument(id: string) {
    await writeDocuments((await readDocuments()).filter((d) => d.id !== id));
    setDocs((prev) => prev.filter((d) => d.meta.id !== id));
    await deleteDocFile(id);
  }

  // 매칭은 문서가 아니라 용어 키에 묶는다. 같은 말이 다른 기획서나 새 판에 나와도 그대로 쓴다.
  async function setMapping(mapping: DocMapping) {
    const next = [...(await readDocMappingsFile<DocMapping>()).filter((m) => m.key !== mapping.key), mapping];
    await writeDocMappingsFile(next);
    setMappings(next);
  }

  async function clearMapping(key: string) {
    const next = (await readDocMappingsFile<DocMapping>()).filter((m) => m.key !== key);
    await writeDocMappingsFile(next);
    setMappings(next);
  }

  async function setGlossary(text: string) {
    await writeGlossaryFile(text);
    setGlossaryState(text);
  }

  async function addRelations(added: Relation[]) {
    await editRelations((list) => [...list, ...added]);
  }

  async function removeRelation(id: string) {
    await editRelations((list) => list.filter((r) => r.id !== id));
  }

  return (
    <WorkspaceContext
      value={{
        sources,
        relations,
        docs,
        mappings,
        glossary,
        addDocument,
        replaceDocument,
        reloadFromOrigin,
        removeDocument,
        setMapping,
        clearMapping,
        setGlossary,
        initialized,
        initError,
        addFile,
        addDatabase,
        reloadSource,
        keepDbBaseline,
        replaceFile,
        removeSource,
        setHeader,
        addRelations,
        removeRelation,
      }}
    >
      {children}
    </WorkspaceContext>
  );
}

// 소스의 내용이 바뀌었는지 가리는 문자열. 파일 교체, 헤더 변경, DB 다시 불러오기 때 바뀐다.
// 화면에서 열 목록이나 행 수를 다시 읽을지 정할 때 쓴다.
export function sourceVersion(s: WorkspaceSource) {
  const m = s.meta;
  const content = isFileSource(m) ? `${m.header}:${m.replacedAt ?? ""}` : (m.loadedAt ?? "");
  return `${m.id}:${s.status}:${content}:${s.tables.join(",")}`;
}

// 하이드레이션 중에는 서버가 그린 것과 같은 빈 작업 공간을 돌려준다(38단계).
// 사이드바와 화면은 Suspense 안에 있어 WorkspaceProvider보다 늦게 하이드레이션될 수 있다. 그 사이에 OPFS 복원이 끝나면
// 서버 HTML(「불러온 파일 없음」)과 브라우저가 그리려는 것(소스 목록)이 달라 hydration 오류가 났다.
// useSyncExternalStore는 하이드레이션 때 서버 값(false)을 쓰고 끝나면 곧바로 브라우저 값(true)으로 다시 그린다.
const noopSubscribe = () => () => {};
const EMPTY = { sources: [], relations: [], docs: [], mappings: [], initialized: false, initError: null } satisfies Partial<WorkspaceValue>;

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!value) throw new Error("WorkspaceProvider 안에서만 쓸 수 있습니다.");
  return hydrated ? value : { ...value, ...EMPTY, glossary: DEFAULT_GLOSSARY };
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
