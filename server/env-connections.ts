import "server-only";
import { readFile } from "node:fs/promises";
import { assertAllowedPath } from "@/server/roots";
import type { ConnectionInput } from "@/server/connections";

// 환경변수에서 DB 접속 정보를 찾는다. 두 가지 꼴을 알아본다.
// 1) 접두어 묶음: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (GAME_DB_*, MYSQL_* 등 접두어는 자유)
// 2) URL: DATABASE_URL=mysql://user:pass@host:3306/db 처럼 mysql:// 또는 mariadb:// 로 시작하는 값
export interface EnvConnection {
  id: string; // 출처와 접두어(또는 URL 변수 이름)로 만든 id
  origin: string; // "앱 환경변수" 또는 .env 파일 경로
  variables: string; // 화면에 보여줄 변수 이름 묶음. 예: GAME_DB_*
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
}

interface Found extends EnvConnection {
  password: string;
}

// 간단한 .env 해석기. KEY=VALUE, 따옴표, export, # 주석을 다룬다.
export function parseDotenv(text: string) {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

const PREFIX = /^(.*(?:DB|MYSQL|MARIADB|DATABASE)_)(?:HOST|HOSTNAME)$/i;

function pick(env: Record<string, string | undefined>, prefix: string, names: string[]) {
  for (const n of names) {
    const v = env[`${prefix}${n}`];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function detect(env: Record<string, string | undefined>, origin: string): Found[] {
  const found: Found[] = [];
  for (const key of Object.keys(env)) {
    const m = key.match(PREFIX);
    if (m) {
      const prefix = m[1];
      const host = env[key]!;
      const user = pick(env, prefix, ["USER", "USERNAME"]);
      const database = pick(env, prefix, ["NAME", "DATABASE", "DB", "SCHEMA"]);
      if (!host || !user || !database) continue;
      const password = pick(env, prefix, ["PASSWORD", "PASS", "PWD"]) ?? "";
      found.push({
        id: `${origin}|${prefix}`,
        origin,
        variables: `${prefix}*`,
        host,
        port: Number(pick(env, prefix, ["PORT"]) ?? 3306),
        user,
        database,
        password,
        hasPassword: password !== "",
      });
    }
    const value = env[key];
    if (/(URL|DSN)$/i.test(key) && value && /^(mysql|mariadb):\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
        if (!url.hostname || !url.username || !database) continue;
        const password = decodeURIComponent(url.password);
        found.push({
          id: `${origin}|${key}`,
          origin,
          variables: key,
          host: url.hostname,
          port: Number(url.port || 3306),
          user: decodeURIComponent(url.username),
          database,
          password,
          hasPassword: password !== "",
        });
      } catch {
        // URL 꼴이 아니면 건너뛴다.
      }
    }
  }
  return found;
}

async function findAll(file?: string): Promise<Found[]> {
  const result = detect(process.env, "이 PC의 앱 설정");
  if (file) {
    // 접속 정보 파일도 정한 폴더 안의 .env 꼴 파일(.env, .env.local, db.env)만 읽는다.
    const path = await assertAllowedPath(file);
    if (!/(^\.env|\.env$)/i.test(path.split(/[\\/]/).pop() ?? "")) throw Object.assign(new Error("not an env file"), { code: "NOT_ALLOWED" });
    result.push(...detect(parseDotenv(await readFile(path, "utf8")), path));
  }
  return result;
}

// 화면에는 비밀번호를 빼고 보낸다.
export async function listEnvConnections(file?: string): Promise<EnvConnection[]> {
  return (await findAll(file)).map(({ password: _, ...rest }) => {
    void _;
    return rest;
  });
}

export async function resolveEnvConnection(id: string, file?: string): Promise<ConnectionInput | null> {
  const found = (await findAll(file)).find((f) => f.id === id);
  if (!found) return null;
  return {
    name: `${found.database}@${found.host} (${found.variables})`,
    host: found.host,
    port: found.port,
    user: found.user,
    password: found.password,
    database: found.database,
  };
}
