// next build가 만든 .next/standalone 폴더에는 화면용 정적 파일(public, .next/static)이
// 빠져 있다(원래는 CDN에서 제공하라는 의도). 설치형 프로그램은 CDN이 없으니 직접 복사해 넣는다.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("❌ .next/standalone/server.js가 없습니다. next.config.ts에 output: \"standalone\"이 있는지 확인하세요.");
  process.exit(1);
}

const copies = [
  [path.join(root, "public"), path.join(standalone, "public")],
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`복사 완료: ${path.relative(root, from)} → ${path.relative(root, to)}`);
}
