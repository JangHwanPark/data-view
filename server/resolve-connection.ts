import "server-only";
import { getConnection, getPassword, type ConnectionInput } from "@/server/connections";
import { resolveEnvConnection } from "@/server/env-connections";

// 저장된 연결 id로 실제 접속 정보를 만든다. 서버 안에서만 쓴다.
// 환경변수에서 찾은 접속은 그 설정을 다시 읽고, 화면에서 저장한 접속은 비밀번호를 복호화한다.
export async function resolveConnection(id: string): Promise<ConnectionInput | null> {
  const stored = getConnection(id);
  if (!stored) return null;
  if (stored.env) return resolveEnvConnection(stored.env.id, stored.env.file).catch(() => null);
  if (!stored.passwordEnc) return null;
  return {
    name: stored.name,
    host: stored.host,
    port: stored.port,
    user: stored.user,
    database: stored.database,
    password: getPassword(stored),
  };
}
