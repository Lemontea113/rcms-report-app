import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright는 내부적으로 자기 파일 경로를 기준으로 동작(브라우저 실행 파일 탐색 등)해서,
  // Next.js가 번들링하면 그 경로 탐색이 깨질 수 있다. 번들링하지 않고 node_modules에서
  // 그대로 불러오도록 제외한다.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
