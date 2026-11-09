"use client";

import { useEffect, useState } from "react";

// 서버의 보안 설정(PLAN.md 21단계). 파일을 열 수 있는 폴더와 DB 비밀번호 저장 여부. 한 번만 읽는다.
export interface AppConfig {
  roots: string[];
  sampleRoot: string;
  saveDbPasswords: boolean;
}

let pending: Promise<AppConfig> | null = null;
export function loadAppConfig() {
  pending ??= fetch("/api/config")
    .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    let active = true;
    loadAppConfig()
      .then((c) => active && setConfig(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return config;
}
