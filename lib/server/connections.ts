import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keyFile } from "@/lib/server/settings";

// 접속 정보는 서버 쪽 data/connections.json에 둔다(PLAN.md 1-3).
// - 환경변수(.env.local)에서 찾은 접속은 비밀번호를 저장하지 않고, 어느 설정인지만 남겨 쓸 때마다 다시 읽는다. 기본은 이쪽이다.
// - 화면에서 입력한 비밀번호는 DATA_VIEW_SAVE_DB_PASSWORDS=1일 때만 AES-256-GCM으로 암호화해 저장한다.
//   키는 data 밖(사용자 폴더)에 두어, data 폴더만 복사해서는 비밀번호를 풀 수 없다.
const DATA_DIR = join(process.cwd(), "data");
const CONNECTIONS_FILE = join(DATA_DIR, "connections.json");

export interface ConnectionInput {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface StoredConnection extends Omit<ConnectionInput, "password"> {
  id: string;
  type: "mysql";
  passwordEnc?: string; // 화면에서 입력해 저장한 접속만 있다
  env?: { id: string; file?: string }; // 환경변수에서 찾은 접속. 쓸 때마다 이 설정을 다시 읽는다
  createdAt: string;
}

// 화면으로 내보내는 형태. 비밀번호는 절대 포함하지 않는다.
export type PublicConnection = Omit<StoredConnection, "passwordEnc">;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// APP_SECRET이 있으면 그것을, 없으면 처음 쓸 때 사용자 폴더에 만든 secret.key를 키로 쓴다.
function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (secret) return createHash("sha256").update(secret).digest();
  const file = keyFile();
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
}

function encrypt(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function decrypt(payload: string) {
  const [iv, tag, body] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function readAll(): StoredConnection[] {
  if (!existsSync(CONNECTIONS_FILE)) return [];
  return JSON.parse(readFileSync(CONNECTIONS_FILE, "utf8")) as StoredConnection[];
}

function writeAll(list: StoredConnection[]) {
  ensureDataDir();
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

export function toPublic(conn: StoredConnection): PublicConnection {
  const { passwordEnc, ...rest } = conn;
  void passwordEnc; // 화면으로 내보내는 값에서 빼기만 한다.
  return rest;
}

export function listConnections() {
  return readAll().map(toPublic);
}

export function getConnection(id: string) {
  return readAll().find((c) => c.id === id) ?? null;
}

export function getPassword(conn: StoredConnection) {
  if (!conn.passwordEnc) throw new Error("no saved password");
  return decrypt(conn.passwordEnc);
}

// 환경변수에서 찾은 접속을 비밀번호 없이 저장한다.
export function saveEnvConnection(input: Omit<ConnectionInput, "password">, env: { id: string; file?: string }): PublicConnection {
  const conn: StoredConnection = { ...input, id: randomBytes(6).toString("hex"), type: "mysql", env, createdAt: new Date().toISOString() };
  writeAll([...readAll(), conn]);
  return toPublic(conn);
}

export function saveConnection(input: ConnectionInput): PublicConnection {
  const { password, ...rest } = input;
  const conn: StoredConnection = {
    ...rest,
    id: randomBytes(6).toString("hex"),
    type: "mysql",
    passwordEnc: encrypt(password),
    createdAt: new Date().toISOString(),
  };
  writeAll([...readAll(), conn]);
  return toPublic(conn);
}

export function deleteConnection(id: string) {
  writeAll(readAll().filter((c) => c.id !== id));
}

// 요청 본문을 검사해서 ConnectionInput으로 바꾼다. 틀리면 null.
export function parseConnectionInput(body: unknown): ConnectionInput | null {
  const b = body as Partial<Record<keyof ConnectionInput, unknown>>;
  const port = Number(b?.port);
  if (
    typeof b?.host !== "string" || !b.host.trim() ||
    typeof b.user !== "string" || !b.user.trim() ||
    typeof b.database !== "string" || !b.database.trim() ||
    typeof b.password !== "string" ||
    !Number.isInteger(port) || port <= 0 || port > 65535
  ) {
    return null;
  }
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : `${b.database.trim()}@${b.host.trim()}`;
  return { name, host: b.host.trim(), port, user: b.user.trim(), password: b.password, database: b.database.trim() };
}
