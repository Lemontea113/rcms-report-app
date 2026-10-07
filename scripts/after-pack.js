// electron-builder가 프로그램을 포장한 직후, 설치 파일로 묶기 전에 실행된다.
// extraResources로 복사하면 electron-builder가 "node_modules"와 ".next" 폴더를 자동으로
// 걸러내 버려서 화면 서버가 동작하지 않는다 — 그래서 standalone 폴더를 통째로 직접 복사한다.

const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const from = path.join(context.packager.projectDir, ".next", "standalone");
  const to = path.join(context.appOutDir, "resources", "web");

  if (!fs.existsSync(path.join(from, "server.js"))) {
    throw new Error(".next/standalone/server.js가 없습니다. 먼저 npm run build:web을 실행하세요.");
  }

  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`  • 화면 서버 복사 완료 → ${path.relative(context.packager.projectDir, to)}`);
};
