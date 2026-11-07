import type { NextConfig } from "next";

// Node 없이 도는 설치본(29단계, scripts/package-win.mjs)을 만들 때만 standalone으로 빌드한다.
// 개발 서버와 npm run start가 쓰는 .next를 건드리지 않도록 빌드 폴더도 따로 쓴다.
const forPackage = process.env.DATA_VIEW_PACKAGE === "1";

const nextConfig: NextConfig = {
  ...(forPackage
    ? {
        output: "standalone" as const,
        distDir: ".next-package",
        // 서버가 경로로 읽는 폴더(테스트 데이터, 사용자 설정, 예전 결과)는 따라 넣지 않는다.
        outputFileTracingExcludes: { "*": ["./fixtures/**", "./dist/**", "./data/**", "./.next/**", "./docs/**"] },
      }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
