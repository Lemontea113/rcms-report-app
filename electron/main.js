// 설치형 프로그램의 본체.
// 1) 프로그램 안에 들어 있는 웹 화면 서버(Next.js standalone)를 이 컴퓨터 안에서만 켜고,
// 2) 그 화면을 프로그램 창에 띄우고,
// 3) GitHub Releases에 새 버전이 올라왔는지 확인해 사용자에게 업데이트를 권한다.

const { app, BrowserWindow, dialog, shell, utilityProcess } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 켜 둔 채로 오래 쓰는 경우를 위해 4시간마다 다시 확인
const SERVER_READY_TIMEOUT_MS = 30000;

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let logStream = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logStream) logStream.write(line);
  else process.stdout.write(line);
}

function openLogFile() {
  // 문제가 생겼을 때 원인을 확인할 수 있도록 서버 출력을 파일로 남긴다.
  // 위치: %APPDATA%\RCMS Report App\logs\main.log
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(logDir, "main.log"), { flags: "w" });
}

// 웹 화면 서버 파일 위치: 설치된 프로그램에서는 resources/web, 개발 중에는 .next/standalone
function getWebDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.join(__dirname, "..", ".next", "standalone");
}

// 다른 프로그램과 겹치지 않도록, 운영체제에게 비어 있는 포트 번호를 하나 받아 온다.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("화면 서버가 제시간에 켜지지 않았습니다."));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

async function startWebServer() {
  const webDir = getWebDir();
  const serverScript = path.join(webDir, "server.js");
  if (!fs.existsSync(serverScript)) {
    throw new Error(`화면 서버 파일을 찾을 수 없습니다: ${serverScript}`);
  }

  const port = await getFreePort();
  // 127.0.0.1로만 열어서, 같은 네트워크의 다른 컴퓨터에서는 접속할 수 없게 한다.
  serverProcess = utilityProcess.fork(serverScript, [], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: "pipe",
    serviceName: "RCMS Report Server",
  });
  serverProcess.stdout?.on("data", (chunk) => log(`[server] ${chunk.toString().trimEnd()}`));
  serverProcess.stderr?.on("data", (chunk) => log(`[server:err] ${chunk.toString().trimEnd()}`));
  serverProcess.on("exit", (code) => {
    log(`화면 서버 종료 (code ${code})`);
    serverProcess = null;
  });

  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl, SERVER_READY_TIMEOUT_MS);
  log(`화면 서버 시작: ${serverUrl}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    title: `정산 업무 자동화 v${app.getVersion()}`,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.setMenu(null);
  // 웹 화면의 <title>이 창 제목을 덮어쓰지 않도록 해서, 버전 번호가 항상 보이게 한다.
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  // 프로그램 화면 밖의 주소로 이동하려 하면 프로그램 창 대신 기본 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(serverUrl)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // 결과 엑셀을 받을 때 저장 위치를 묻는 창을 띄우되, 기본 위치는 '다운로드' 폴더로 한다.
  mainWindow.webContents.session.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({
      title: "결과 엑셀 저장",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(serverUrl);
}

// 프로그램을 끌 때, 열려 있던 로그인 창(RCMS·이지바로)도 같이 닫히도록 먼저 정리 요청을 보낸다.
function requestServerCleanup() {
  return new Promise((resolve) => {
    if (!serverUrl || !serverProcess) return resolve();
    const req = http.request(`${serverUrl}/api/shutdown`, { method: "POST", timeout: 3000 }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", resolve);
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.end();
  });
}

let serverShutDown = false;
async function shutdownServer() {
  if (serverShutDown) return;
  serverShutDown = true;
  await requestServerCleanup();
  serverProcess?.kill();
}

// ── 업데이트 확인 ──────────────────────────────────────────────
// 새 버전을 자동으로 몰래 설치하지 않고, 사용자에게 물어본 뒤 동의하면 내려받아 설치한다.
function setupAutoUpdater() {
  if (!app.isPackaged) return; // 개발 중에는 확인하지 않는다.

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // 오류는 아래 "error" 이벤트에서 한 번만 짧게 남긴다(라이브러리 기본 기록은 응답 내용까지 길게 찍는다).
  autoUpdater.logger = { info: log, warn: log, error: () => {}, debug: () => {} };

  autoUpdater.on("update-available", async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "업데이트 안내",
      message: `새 버전(v${info.version})이 나왔습니다. 지금 업데이트할까요?`,
      detail: `현재 버전: v${app.getVersion()}\n\n업데이트 파일을 내려받는 동안에도 프로그램을 계속 쓸 수 있습니다.`,
      buttons: ["업데이트", "나중에"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      autoUpdater.downloadUpdate().catch((err) => log(`업데이트 다운로드 실패: ${err.message}`));
    }
  });

  autoUpdater.on("download-progress", (p) => {
    mainWindow?.setProgressBar(p.percent / 100);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    mainWindow?.setProgressBar(-1);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "업데이트 준비 완료",
      message: `새 버전(v${info.version})을 설치할 준비가 됐습니다.`,
      detail: "지금 다시 시작하면 바로 설치됩니다. '나중에'를 누르면 프로그램을 끌 때 설치됩니다.\n\n진행 중인 조회 작업이 있다면 끝난 뒤에 다시 시작하세요.",
      buttons: ["지금 다시 시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      await shutdownServer();
      autoUpdater.quitAndInstall();
    }
  });

  // 인터넷이 안 되는 등 확인에 실패해도 프로그램 사용에는 지장이 없으므로 기록만 남긴다.
  autoUpdater.on("error", (err) => log(`업데이트 확인 오류: ${err.message.split("\n")[0]}`));

  // 실패는 위 "error" 이벤트에서 이미 기록되므로 여기서는 무시한다.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

// ── 프로그램 시작/종료 ─────────────────────────────────────────
// 프로그램을 두 번 실행하면 창이 두 개, 서버가 두 개 생기므로 이미 켜진 창을 앞으로 가져온다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    openLogFile();
    log(`프로그램 시작 v${app.getVersion()}`);
    try {
      await startWebServer();
    } catch (err) {
      log(`시작 실패: ${err.message}`);
      dialog.showErrorBox(
        "프로그램을 시작하지 못했습니다",
        `${err.message}\n\n기록 파일: ${path.join(app.getPath("userData"), "logs", "main.log")}`
      );
      app.quit();
      return;
    }
    createWindow();
    setupAutoUpdater();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", async (e) => {
    if (serverShutDown) return;
    e.preventDefault();
    await shutdownServer();
    app.quit();
  });
}
