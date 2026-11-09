import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

function layer(files, group, message) {
  return [{ files: [files], rules: { "no-restricted-imports": ["error", { patterns: [{ group, message }] }] } }];
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 폴더 구조와 의존 방향(38단계, docs/DESIGN.md 「폴더 구조」): app → features → core → shared.
  // 기능 밖에서는 기능의 index.ts(@/features/<기능>)로만 가져오고, 브라우저 코드는 server/를 가져오지 않는다.
  ...layer("shared/**", ["@/app/*", "@/features", "@/features/*", "@/core/*", "@/server/*"], "shared는 앱을 모르는 코드라 core, features, server를 가져오지 않습니다."),
  ...layer("core/**", ["@/app/*", "@/features", "@/features/*", "@/server/*"], "core는 여러 기능이 같이 쓰는 데이터 모델이라 features와 server를 가져오지 않습니다."),
  ...layer("features/**", ["@/app/*", "@/features/*/*", "@/server/*"], "다른 기능은 @/features/<기능>(index.ts)으로만 가져오고, server는 API로만 씁니다."),
  ...layer("server/**", ["@/app/*", "@/features", "@/features/*", "@/core/*"], "server는 브라우저 코드(core, features)를 가져오지 않습니다."),
  ...layer("app/**", ["@/features/*/*"], "기능은 @/features/<기능>(index.ts)으로만 가져옵니다."),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // postinstall에서 복사하는 duckdb-wasm 빌드 결과물
    "public/duckdb/**",
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
