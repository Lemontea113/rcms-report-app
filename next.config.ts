import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 설치형 프로그램(Electron)에 넣기 위해, 실행에 필요한 파일만 .next/standalone에
  // 따로 모아 node_modules 설치 없이도 돌아가는 서버를 만든다.
  output: "standalone",
  // playwright는 내부적으로 자기 파일 경로를 기준으로 동작(브라우저 실행 파일 탐색 등)해서,
  // Next.js가 번들링하면 그 경로 탐색이 깨질 수 있다. 번들링하지 않고 node_modules에서
  // 그대로 불러오도록 제외한다.
  serverExternalPackages: ["playwright"],
  // playwright는 실행 중에 필요한 파일을 동적으로 불러와서 자동 추적에서 빠질 수 있다 —
  // standalone 폴더에 통째로 포함시킨다.
  outputFileTracingIncludes: {
    "/*": ["node_modules/playwright/**/*", "node_modules/playwright-core/**/*"],
  },
  // playwright 안의 Electron 지원 코드 때문에 Electron 본체(수백 MB)까지 따라 들어온다 —
  // 이 앱은 그 기능을 쓰지 않고, Electron은 설치형 프로그램 껍데기에 이미 들어 있으므로 뺀다.
  outputFileTracingExcludes: {
    "/*": ["node_modules/electron/**/*"],
  },
};

export default nextConfig;
