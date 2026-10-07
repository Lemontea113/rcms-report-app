// dist 폴더에 만들어진 설치 파일을 GitHub Releases에 올린다 (npm run release의 마지막 단계).
// electron-builder의 자체 업로드는 업로드 작업 두 개가 동시에 릴리스를 만들려다 충돌해서
// 파일 일부(latest.yml 등)가 빠지는 일이 있었다 — 그래서 직접 검사한 뒤 gh CLI로 한 번에 올린다.

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const { version } = require(path.join(root, "package.json"));
const tag = `v${version}`;
const dist = path.join(root, "dist");
const exeName = `RCMS-Report-App-Setup-${version}.exe`;
const files = [exeName, `${exeName}.blockmap`, "latest.yml"].map((f) => path.join(dist, f));

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

for (const f of files) {
  if (!fs.existsSync(f)) fail(`${path.relative(root, f)} 파일이 없습니다. 먼저 설치 파일을 만들어야 합니다.`);
}

// 사용자 프로그램은 latest.yml에 적힌 체크섬으로 내려받은 설치 파일을 검사한다 —
// 둘이 다르면 업데이트가 실패하므로, 올리기 전에 반드시 짝이 맞는지 확인한다.
const latestYml = fs.readFileSync(path.join(dist, "latest.yml"), "utf-8");
const exeSha = crypto.createHash("sha512").update(fs.readFileSync(path.join(dist, exeName))).digest("base64");
if (!latestYml.includes(`version: ${version}`) || !latestYml.includes(exeSha)) {
  fail("latest.yml의 버전/체크섬이 설치 파일과 맞지 않습니다. npm run release를 처음부터 다시 실행하세요.");
}

try {
  execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
  fail(`${tag} 릴리스가 이미 있습니다. package.json의 version을 올린 뒤 다시 실행하세요.`);
} catch {
  // 릴리스가 없으면 정상 — 새로 만든다.
}

console.log(`${tag} 릴리스를 만들고 파일 ${files.length}개를 올리는 중...`);
execFileSync("gh", ["release", "create", tag, ...files, "--title", version, "--notes", `${tag} 배포`], {
  stdio: "inherit",
  cwd: root,
});
console.log(`✅ 배포 완료: https://github.com/Lemontea113/rcms-report-app/releases/tag/${tag}`);
