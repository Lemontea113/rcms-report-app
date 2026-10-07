import fs from "fs";
import path from "path";
import type { NextConfig } from "next";

// 패키지 하나와 그 패키지가 쓰는 하위 패키지 전체의 이름을 모은다.
function collectDependencyTree(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen;
  const pkgJson = path.join(process.cwd(), "node_modules", name, "package.json");
  if (!fs.existsSync(pkgJson)) return seen;
  seen.add(name);
  const { dependencies = {} } = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
  for (const dep of Object.keys(dependencies)) collectDependencyTree(dep, seen);
  return seen;
}

// tesseract.js는 글자 인식을 별도 작업 스크립트(worker)로 실행하는데, 그 스크립트가 쓰는 패키지
// (bmp-js, zlibjs 등)는 자동 추적이 못 찾는다 — 하위 패키지까지 전부 포함시킨다.
const tesseractPackages = [...collectDependencyTree("tesseract.js")].map((name) => `node_modules/${name}/**/*`);

const nextConfig: NextConfig = {
  // 설치형 프로그램(Electron)에 넣기 위해, 실행에 필요한 파일만 .next/standalone에
  // 따로 모아 node_modules 설치 없이도 돌아가는 서버를 만든다.
  output: "standalone",
  // playwright·tesseract.js는 내부적으로 자기 파일 경로를 기준으로 동작(브라우저 실행 파일
  // 탐색, 글자 인식 작업용 스크립트 실행 등)해서, Next.js가 번들링하면 그 경로 탐색이 깨질 수 있다.
  // 번들링하지 않고 node_modules에서 그대로 불러오도록 제외한다.
  serverExternalPackages: ["playwright", "tesseract.js", "sharp"],
  // 위 패키지들은 실행 중에 필요한 파일(작업 스크립트, wasm 등)을 동적으로 불러와서 자동 추적에서
  // 빠질 수 있다 — standalone 폴더에 통째로 포함시킨다. ocr-data는 글자 인식용 한글·영문 데이터다.
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/playwright/**/*",
      "node_modules/playwright-core/**/*",
      ...tesseractPackages,
      // sharp(이미지 처리)의 .node 파일이 함께 쓰는 DLL은 자동 추적이 못 찾는다.
      "node_modules/@img/sharp-win32-x64/**/*",
      "ocr-data/**/*",
    ],
  },
  // playwright 안의 Electron 지원 코드 때문에 Electron 본체(수백 MB)까지 따라 들어온다 —
  // 이 앱은 그 기능을 쓰지 않고, Electron은 설치형 프로그램 껍데기에 이미 들어 있으므로 뺀다.
  outputFileTracingExcludes: {
    "/*": ["node_modules/electron/**/*"],
  },
};

export default nextConfig;
