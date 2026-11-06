"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, PlugZap } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { useAppConfig } from "@/lib/client/app-config";
import { DbRequestError, dbErrorText, requestJson } from "@/lib/client/db-import";

interface Form {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

const EMPTY: Form = { name: "", host: "127.0.0.1", port: "3306", user: "", password: "", database: "" };

const inputClass =
  "w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; action: "test" | "connect" }
  | { kind: "ok"; tableCount: number }
  | { kind: "error"; text: string; detail: string };

interface EnvConnection {
  id: string;
  origin: string;
  variables: string;
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
}

// 환경변수에서 찾은 접속 정보로 바로 연결한다. 비밀번호는 서버에만 있고 화면에는 "있음/없음"만 보인다.
function EnvConnections({ primary = false }: { primary?: boolean }) {
  const { addDatabase } = useWorkspace();
  const router = useRouter();
  const [file, setFile] = useState("");
  const [found, setFound] = useState<EnvConnection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; detail: string } | null>(null);

  async function find(e?: FormEvent) {
    e?.preventDefault();
    setBusy("find");
    setError(null);
    try {
      const { connections } = await requestJson<{ connections: EnvConnection[] }>("/api/env-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
      setFound(connections);
    } catch (err) {
      setError({ text: err instanceof DbRequestError && err.code === "NOT_FOUND" ? "접속 정보 파일을 찾을 수 없습니다. 경로를 확인하거나, 개발팀에서 받은 접속 정보를 위 칸에 직접 입력해 주세요." : "이 PC에 저장된 DB 접속 정보를 찾지 못했습니다. 개발팀에서 받은 접속 정보를 위 칸에 직접 입력해 주세요.", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function connect(c: EnvConnection) {
    setBusy(c.id);
    setError(null);
    try {
      const { connection } = await requestJson<{ connection: { id: string; name: string; database: string } }>("/api/env-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, connect: c.id }),
      });
      const id = await addDatabase({ connectionId: connection.id, name: connection.name, database: connection.database });
      router.push(`/sources/${id}`);
    } catch (err) {
      setError({ text: err instanceof DbRequestError ? dbErrorText(err.code) : "DB에 연결하지 못했습니다. 접속 정보를 다시 확인하거나 개발팀에 문의해 주세요.", detail: err instanceof Error ? err.message : String(err) });
      setBusy(null);
    }
  }

  return (
    <details open={primary || undefined} className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer font-semibold">{primary ? "환경변수에서 불러오기" : "고급: 접속 정보 파일에서 불러오기"}</summary>
      <p className="mt-2 text-xs text-zinc-500">
        {primary
          ? "앱 폴더의 .env.local에 적어 둔 DB 접속 정보를 찾습니다. 경로를 비우고 찾기를 누르면 됩니다. 개발팀이 따로 준 .env 파일이 있으면, 열 수 있게 정한 폴더 안에 두고 그 경로를 적어 주세요. 비밀번호는 앱에 저장하지 않고 쓸 때마다 이 설정에서 다시 읽습니다."
          : "개발팀이 접속 정보를 파일(.env)로 준 경우에만 씁니다. 파일 경로를 적고 찾기를 누르면 그 안의 DB 접속 정보를 찾아 보여줍니다. 경로를 비우고 찾으면 이 PC의 앱 설정에서 찾습니다."}
      </p>
      <form onSubmit={(e) => void find(e)} className="mt-2 flex gap-2">
        <input
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="접속 정보 파일 경로 (예: D:\\game\\db.env)"
          aria-label="접속 정보 파일 경로"
          className={`${inputClass} font-mono text-xs`}
        />
        <button type="submit" disabled={busy !== null} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {busy === "find" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          찾기
        </button>
      </form>
      {found && found.length === 0 && <p className="text-xs text-zinc-500">DB 접속 정보를 찾지 못했습니다. 개발팀에서 받은 접속 정보를 위 칸에 직접 입력해 주세요.</p>}
      {found && found.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
          {found.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-mono">{c.variables}</span>
              <span className="text-zinc-500">
                {c.user}@{c.host}:{c.port}/{c.database}, 비밀번호 {c.hasPassword ? "있음" : "없음"}
              </span>
              <span className="w-full truncate text-zinc-400" title={c.origin}>
                {c.origin}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void connect(c)}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {busy === c.id && <Loader2 className="size-3 animate-spin" aria-hidden />}
                연결하고 불러오기
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{error.text}</p>
          <details className="mt-1">
            <summary className="cursor-pointer">자세히</summary>
            <pre className="mt-1 whitespace-pre-wrap">{error.detail}</pre>
          </details>
        </div>
      )}
    </details>
  );
}

export function DatabaseConnectForm() {
  const config = useAppConfig();
  if (!config) return <p className="text-zinc-500">불러오는 중...</p>;
  // 기본은 비밀번호를 앱에 저장하지 않고 .env.local에서만 읽는다(PLAN.md 1-3).
  if (!config.saveDbPasswords) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">개발 DB에서 불러오기</h1>
          <p className="text-zinc-500">
            엑셀 대신 개발 DB(MySQL, MariaDB)에서 테이블을 바로 불러옵니다. 보안 때문에 DB 비밀번호를 화면에서 입력해 저장하지 않고, 앱 폴더의 .env.local에 적어 둔 접속 정보만 씁니다.
          </p>
        </div>
        <EnvConnections primary />
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <p className="font-medium">.env.local 예시 (값은 개발팀에서 받은 것으로)</p>
          <pre className="mt-1 font-mono">{"GAME_DB_HOST=127.0.0.1\nGAME_DB_PORT=3306\nGAME_DB_USER=reader\nGAME_DB_PASSWORD=...\nGAME_DB_NAME=game"}</pre>
          <p className="mt-1">.env.local을 고친 뒤에는 앱을 껐다가 다시 켜 주세요. 데이터를 고칠 수 없는 읽기 전용 계정을 받는 것이 안전합니다.</p>
        </div>
      </div>
    );
  }
  return <ManualConnectForm />;
}

// 화면에서 접속 정보를 입력해 저장하는 방식. .env.local의 DATA_VIEW_SAVE_DB_PASSWORDS=1일 때만 보인다.
function ManualConnectForm() {
  const { addDatabase } = useWorkspace();
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const body = () => JSON.stringify({ ...form, port: Number(form.port) });
  const busy = status.kind === "busy";
  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function fail(e: unknown) {
    setStatus({
      kind: "error",
      text: e instanceof DbRequestError ? dbErrorText(e.code) : "요청하지 못했습니다.",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  async function test() {
    setStatus({ kind: "busy", action: "test" });
    try {
      const { tableCount } = await requestJson<{ tableCount: number }>("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body(),
      });
      setStatus({ kind: "ok", tableCount });
    } catch (e) {
      fail(e);
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "busy", action: "connect" });
    try {
      const { connection } = await requestJson<{ connection: { id: string; name: string; database: string } }>("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body(),
      });
      const id = await addDatabase({ connectionId: connection.id, name: connection.name, database: connection.database });
      router.push(`/sources/${id}`);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">개발 DB에서 불러오기</h1>
        <p className="text-zinc-500">
          엑셀 대신 개발 DB(MySQL, MariaDB)에서 테이블을 바로 불러옵니다. 불러온 테이블은 엑셀 파일과 똑같이 연결을 보고 따라갈 수 있습니다. 아래 칸은 개발팀에서 받은 DB 접속 정보로 채워 주세요. 데이터를 고칠 수 없는 읽기 전용 계정을 받는 것이 안전합니다.
        </p>
      </div>

      <form onSubmit={connect} className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label htmlFor="db-name" className="text-zinc-500">표시 이름</label>
        <input id="db-name" className={inputClass} value={form.name} onChange={set("name")} placeholder="사이드바에 보일 이름. 비워 두면 자동으로 정합니다" />
        <label htmlFor="db-host" className="text-zinc-500" title="개발팀에서 받은 서버 주소와 포트 번호">서버 주소</label>
        <div className="flex gap-2">
          <input id="db-host" className={inputClass} value={form.host} onChange={set("host")} required />
          <input aria-label="포트 번호" title="포트 번호" className={`${inputClass} w-24`} value={form.port} onChange={set("port")} inputMode="numeric" required />
        </div>
        <label htmlFor="db-user" className="text-zinc-500">아이디</label>
        <input id="db-user" className={inputClass} value={form.user} onChange={set("user")} autoComplete="off" required />
        <label htmlFor="db-password" className="text-zinc-500">비밀번호</label>
        <input id="db-password" type="password" className={inputClass} value={form.password} onChange={set("password")} autoComplete="new-password" />
        <label htmlFor="db-database" className="text-zinc-500">DB 이름</label>
        <input id="db-database" className={inputClass} value={form.database} onChange={set("database")} required />

        <div className="col-span-2 mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void test()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {status.kind === "busy" && status.action === "test" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" aria-hidden />}
            연결 확인
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {status.kind === "busy" && status.action === "connect" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            연결하고 불러오기
          </button>
        </div>
      </form>

      {status.kind === "ok" && (
        <p className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4" aria-hidden />
          연결됩니다. 테이블 {status.tableCount}개를 찾았습니다.
        </p>
      )}
      {status.kind === "error" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{status.text}</p>
          <details className="mt-2">
            <summary className="cursor-pointer">자세히</summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs">{status.detail}</pre>
          </details>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        비밀번호는 이 PC 안에만 잠가서 저장하고, 화면에 다시 보여주지 않습니다.
      </p>
      <EnvConnections />
    </div>
  );
}
