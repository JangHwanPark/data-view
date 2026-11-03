import "server-only";
import { getConnection, getPassword, type ConnectionInput } from "@/lib/server/connections";

// 저장된 연결 id로 실제 접속 정보(비밀번호 복호화 포함)를 만든다. 서버 안에서만 쓴다.
export function resolveConnection(id: string): ConnectionInput | null {
  const stored = getConnection(id);
  if (!stored) return null;
  return {
    name: stored.name,
    host: stored.host,
    port: stored.port,
    user: stored.user,
    database: stored.database,
    password: getPassword(stored),
  };
}
