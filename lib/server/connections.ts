import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 접속 정보는 서버 쪽 data/connections.json에 둔다. 비밀번호는 AES-256-GCM으로 암호화한다.
const DATA_DIR = join(process.cwd(), "data");
const CONNECTIONS_FILE = join(DATA_DIR, "connections.json");
const KEY_FILE = join(DATA_DIR, "secret.key");

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
  passwordEnc: string;
  createdAt: string;
}

// 화면으로 내보내는 형태. 비밀번호는 절대 포함하지 않는다.
export type PublicConnection = Omit<StoredConnection, "passwordEnc">;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// APP_SECRET이 있으면 그것을, 없으면 처음 쓸 때 만든 data/secret.key를 키로 쓴다.
function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (secret) return createHash("sha256").update(secret).digest();
  ensureDataDir();
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
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
  return decrypt(conn.passwordEnc);
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
