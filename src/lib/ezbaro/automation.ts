// 이지바로(ezbaro.go.kr) 상시점검 관리 화면에서 과제번호/년도 목록으로 연구원 정보를 수집한다.
// 원래 ezbaro-automation 프로젝트(lib/automation.js)의 조회 로직을 그대로 옮겨 왔고,
// 설치형 프로그램에 맞게 바뀐 점은 다음뿐이다.
//  - 로그인 창은 RCMS 기능과 같은 방식(lib/loginBrowser.ts, 설치된 Chrome)으로 연다.
//  - 글자 인식(OCR) 언어 데이터는 인터넷에서 받지 않고 프로그램에 들어 있는 ocr-data 폴더에서 읽는다.
//  - 디버그 파일은 프로그램 폴더 대신 임시 폴더(%TEMP%\rcms-report-app\ezbaro-debug)에 남긴다.
//  - 성명·휴대폰 글자 인식은 PC의 화면 배율과 상관없이 동작하도록 값 칸만 잘라 읽는다(./ocr.ts).
//    읽은 성명이 목록 화면의 연구책임자와 다르면 비고에 "이름 확인 필요"를 남긴다.

import fs from "fs";
import os from "os";
import path from "path";
import type { Browser, BrowserContext, Page } from "playwright";
import { createWorker, type Worker } from "tesseract.js";
import { launchLoginBrowser } from "../loginBrowser";
import { needsNameCheck, preferGridSpelling, readResearcherInfo, type ResearcherOcrResult } from "./ocr";
import type { EzbaroResult, EzbaroRow } from "./store";

const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const DEBUG_DIR = path.join(os.tmpdir(), "rcms-report-app", "ezbaro-debug");
// standalone 서버는 자기 폴더를 작업 폴더로 삼고 실행되므로, 개발 중이든 설치된 프로그램이든
// process.cwd() 아래에 ocr-data가 있다(next.config.ts의 outputFileTracingIncludes로 함께 포함됨).
const OCR_DATA_DIR = path.join(process.cwd(), "ocr-data");

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// 같은 이름의 폴더가 이미 있으면 "(1)", "(2)"처럼 번호를 붙여 새 폴더 이름을 만든다.
let cachedCaptureRoot: string | null = null;
function resetCaptureRootForNewRun() {
  cachedCaptureRoot = null; // "시작"을 다시 누를 때마다 폴더명을 새로 확인하게 한다.
}
function captureRootDir() {
  if (cachedCaptureRoot) return cachedCaptureRoot;
  const base = path.join(DOWNLOADS_DIR, `${todayStr()}_이지바로_책임자정보_캡쳐`);
  let candidate = base;
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  cachedCaptureRoot = candidate;
  return cachedCaptureRoot;
}

// "기관명 (058246)" 처럼 뒤에 붙는 괄호 속 번호를 떼어내고 기관명만 남긴다.
function cleanOrgName(name: string) {
  return (name || "").replace(/\s*\([0-9]+\)\s*$/, "").trim();
}

// 폴더/파일 이름으로 쓸 수 없는 문자(\ / : * ? " < > |)를 안전하게 바꾼다.
function sanitizeForFilename(name: string) {
  return (name || "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

// 성명·휴대폰은 코드(HTML)로 읽는 방법이 계속 안 되어서, 화면을 사진으로 찍어
// 글자 인식(OCR)으로 읽는 방식으로 대신한다. 매번 새로 만들면 느려서 하나만 만들어 재사용한다.
let ocrWorker: Worker | null = null;
async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker("kor+eng", undefined, {
      langPath: OCR_DATA_DIR,
      gzip: false,
      cacheMethod: "none",
    });
  }
  return ocrWorker;
}
async function terminateOcrWorker() {
  if (ocrWorker) {
    await ocrWorker.terminate().catch(() => {});
    ocrWorker = null;
  }
}

// 성명·휴대폰을 읽는다(방식은 ./ocr.ts 참고). 팝업의 "연구원 정보"는 늦게 채워지므로 먼저 충분히 기다린다.
async function ocrResearcherInfo(popup: Page): Promise<ResearcherOcrResult> {
  const nameLocator = popup.getByText("성명", { exact: true }).first();
  // 일부 팝업은 "연구원 정보" 부분 자체가 코드에 나타나기까지 유독(1분 넘게) 오래 걸려서,
  // 사진을 찍기 전에 "성명" 글자가 실제로 나타날 때까지 아주 넉넉하게 기다린다.
  await nameLocator.waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
  // 라벨(글자)만 나타난 것과 그 옆의 실제 값이 채워진 것은 다른 시점이다.
  // 사진을 찍기 직전에 값이 채워졌는지 한 번 더(최대 60초) 확인해서, 값이 비어있는 순간을 찍지 않게 한다.
  await waitForDetailDataLoaded(popup, 60000);
  try {
    return await readResearcherInfo(popup, await getOcrWorker());
  } catch (e) {
    return { name: "", phone: "", capture: null, cells: {}, debug: `OCR 오류: ${e}` };
  }
}

// ezbaro.go.kr (Nexacro 기반) 화면의 실제 입력 요소는 IDInfo가 매우 길고
// 창 인스턴스마다 가운데 부분이 달라질 수 있어서, id의 "끝부분"만 맞춰서
// 찾는 방식(attribute $=)을 쓴다. 이렇게 하면 창 인스턴스 이름이 바뀌어도 잘 찾는다.
const SEL = {
  checkbox: '[id$="chkOrdtmChckReprtCrtBjF"]',
  yearStart: '[id$="spinEtpStYs.spinedit:input"]',
  yearEnd: '[id$="spinEtpEdYs.spinedit:input"]',
  taskNo: '[id$="edtNewTakN:input"]',
  searchBtn: '[id*="divSearch"][id$="btnSearch"]',
};

interface EzbaroSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

declare global {
  var __ezbaroSession: EzbaroSession | undefined;
}

// 1단계: 사람이 직접 로그인할 수 있도록 눈에 보이는(headless:false) 브라우저를 띄운다.
// 매번 새 브라우저 창을 쓰므로, 이전 로그인 정보를 저장/재사용하지 않고 항상 새로 로그인한다.
export async function openLoginBrowser(): Promise<void> {
  await closeBrowser();
  const browser = await launchLoginBrowser();
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto("https://www.gaia.go.kr/main.do");
  globalThis.__ezbaroSession = { browser, context, page };
}

function getSession(): EzbaroSession {
  const session = globalThis.__ezbaroSession;
  if (!session) throw new Error("브라우저가 열려있지 않습니다. 먼저 로그인을 진행해주세요.");
  return session;
}

// 화면에 보이는 짧은 글자 조각들을 모아서, 실패 원인을 진단할 수 있게 한다.
async function dumpVisibleTextHints(page: Page) {
  const info = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[id$=":text"], [id$="ontent"], div, span'));
    const seen = new Set<string>();
    const hints: string[] = [];
    for (const n of nodes) {
      const t = (n.textContent || "").trim();
      if (t && t.length > 0 && t.length <= 12 && !seen.has(t)) {
        const r = n.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          seen.add(t);
          hints.push(t);
        }
      }
      if (hints.length >= 60) break;
    }
    return { url: location.href, title: document.title, hints };
  });
  return `현재 페이지: ${info.title} (${info.url})\n화면에 보이는 짧은 글자들: ${info.hints.join(" | ")}`;
}

// 로그인 후 "정산 > 상시점검 > 상시점검 관리" 메뉴를 자동으로 눌러 들어간다.
// 메뉴 항목은 눈에 보이는 글자(텍스트) 기준으로 찾는다 - Nexacro 메뉴는
// 체크박스처럼 고정된 id를 미리 알아내기 어려워서, 화면에 보이는 글자로 찾는 방식이 더 안전하다.
async function clickByVisibleText(page: Page, text: string) {
  // exact 매칭을 먼저 짧게 시도하고, 안되면 부분 일치로 한 번 더 시도한다.
  try {
    await page.getByText(text, { exact: true }).first().click({ timeout: 5000 });
    return;
  } catch {
    // 무시하고 아래에서 재시도
  }
  await page.getByText(text, { exact: false }).first().click({ timeout: 5000 });
}

async function navigateToTargetScreen(page: Page) {
  try {
    await clickByVisibleText(page, "정산");
    await page.waitForTimeout(500);
    await clickByVisibleText(page, "상시점검");
    await page.waitForTimeout(500);
    await clickByVisibleText(page, "상시점검 관리");
    await page.waitForTimeout(1000);
  } catch (e) {
    const hint = await dumpVisibleTextHints(page).catch(() => "(화면 정보도 읽지 못했습니다)");
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n---진단 정보---\n${hint}`);
  }
}

// GAIA 포털에서 로그인 후 실제 이지바로(ezbaro.go.kr) 화면은 새 탭으로 열린다.
// 이미 열려있는 탭 중에서 찾아보고, 없으면 새로 열릴 때까지 잠시 기다린다.
async function findEzbaroPage(context: BrowserContext, timeoutMs = 15000): Promise<Page | null> {
  const isEzbaro = (p: Page) => p.url().includes("ezbaro.go.kr");
  const existing = context.pages().find(isEzbaro);
  if (existing) return existing;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = context.pages().find(isEzbaro);
    if (found) return found;
    const newPage = await context
      .waitForEvent("page", { timeout: Math.max(1000, deadline - Date.now()) })
      .catch(() => null);
    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded").catch(() => {});
      if (isEzbaro(newPage)) return newPage;
    }
  }
  return null;
}

export function isBrowserOpen(): boolean {
  const session = globalThis.__ezbaroSession;
  return !!(session && !session.page.isClosed());
}

export async function closeBrowser(): Promise<void> {
  const session = globalThis.__ezbaroSession;
  if (session) {
    await session.browser.close().catch(() => {});
  }
  globalThis.__ezbaroSession = undefined;
  await terminateOcrWorker();
}

// 팝업(과제 상세 화면)은 열리자마자 바로 데이터가 채워지지 않는다 (잠깐의 로딩 시간이 있다).
// 라벨(sta_WF_detailL)은 바로 나오지만 값(sta_WF_detailR / input)은 뒤늦게 채워지므로,
// 실제 값이 하나라도 나타날 때까지 기다렸다가 읽어야 빈 값을 잘못 읽어가지 않는다.
async function waitForDetailDataLoaded(popupPage: Page, timeoutMs = 15000) {
  // "성명" 항목처럼 늦게 채워지는 개인정보가 실제로 나타날 때까지 콕 집어서 기다린다.
  // (다른 항목이 먼저 채워졌다고 성급하게 넘어가면 개인정보 항목이 아직 빈 채로 남아있을 수 있다)
  await popupPage
    .waitForFunction(
      () => {
        function visible(el: Element) {
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        const labels = Array.from(document.querySelectorAll(".sta_WF_detailL"))
          .filter(visible)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { text: (el.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
          });
        const nameLabel = labels.find((n) => n.text === "성명");
        if (!nameLabel) return false;

        const staticValues = Array.from(document.querySelectorAll(".sta_WF_detailR"))
          .filter(visible)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { text: (el.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
          });
        const inputValues = Array.from(document.querySelectorAll<HTMLInputElement>("input.nexainput")).map((el) => {
          const wrapper = el.closest(".Edit") || el.parentElement || el;
          const r = wrapper.getBoundingClientRect();
          return { text: (el.value || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const values = staticValues.concat(inputValues);
        const sameRow = values.filter(
          (v) => Math.abs(v.y + v.h / 2 - (nameLabel.y + nameLabel.h / 2)) < 10 && v.x >= nameLabel.x
        );
        return sameRow.some((v) => v.text.length > 0);
      },
      undefined,
      { timeout: timeoutMs }
    )
    .catch(() => {});
}

interface DetailFields {
  orgType: string;
  orgName: string;
  email: string;
  bizNo: string;
}

// 팝업 안에서 라벨(sta_WF_detailL) 옆에 있는 값을 읽어온다.
// 값은 두 가지 형태로 나온다: ① Static 값 칸(sta_WF_detailR) 안의 글자, ② 읽기전용 입력칸(input)의 value.
// 문서에 쓰여진 순서가 화면에 보이는 순서와 다르므로, 라벨과 "같은 줄, 오른쪽"에 있는 값을
// 화면 좌표 기준으로 찾는다. 같은 이름의 라벨이 여러 섹션에 중복으로 있을 수 있어서(예:
// "연구수행기관"이 전년도 과제정보에도 빈칸으로 존재), 값이 실제로 채워져 있는 라벨을 우선한다.
async function readDetailFields(popupPage: Page): Promise<DetailFields> {
  return popupPage.evaluate(() => {
    function visible(el: Element) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    const labels = Array.from(document.querySelectorAll(".sta_WF_detailL"))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      });

    const staticValues = Array.from(document.querySelectorAll(".sta_WF_detailR"))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      });

    const inputValues = Array.from(document.querySelectorAll<HTMLInputElement>("input.nexainput"))
      .filter((el) => visible(el.closest(".Edit") || el.parentElement || el))
      .map((el) => {
        const wrapper = el.closest(".Edit") || el.parentElement || el;
        const r = wrapper.getBoundingClientRect();
        return { text: (el.value || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      });

    const values = staticValues.concat(inputValues);

    function findValueFor(labelText: string) {
      const candidates = labels.filter((n) => n.text === labelText);
      let firstNonEmpty = "";
      for (const label of candidates) {
        const sameRow = values
          .filter((v) => Math.abs(v.y + v.h / 2 - (label.y + label.h / 2)) < 10 && v.x >= label.x)
          .sort((a, b) => a.x - b.x);
        const val = sameRow.length ? sameRow[0].text : "";
        if (val) return val; // 여러 라벨 중 실제 값이 채워진 것을 우선 채택한다.
        if (!firstNonEmpty) firstNonEmpty = val;
      }
      return firstNonEmpty;
    }

    // 성명·휴대폰은 HTML로는 절대 시도하지 않는다(OCR로만 읽는다) - 여기서 일부러 빼둔다.
    return {
      orgType: findValueFor("참여구분"),
      orgName: findValueFor("연구수행기관"),
      email: findValueFor("이메일"),
      bizNo: findValueFor("사업자등록번호"),
    };
  });
}

// 목록 화면의 표(그리드) 머리글에서 특정 이름의 칸이 몇 번째 칸(열)인지 찾는다.
// 화면 구성이 바뀌어도(칸 순서가 달라져도) 항상 정확한 칸을 찾을 수 있게 하기 위함이다.
async function getGridColumnIndex(page: Page, headerText: string): Promise<number> {
  return page.evaluate((label) => {
    const headers = Array.from(document.querySelectorAll('[id*="calOrdtmChckGrid.head.gridrow_-1.cell_-1_"]'));
    for (const h of headers) {
      if ((h.textContent || "").trim() === label) {
        const m = h.id.match(/cell_-1_(\d+)/);
        if (m) return Number(m[1]);
      }
    }
    return -1;
  }, headerText);
}

async function getGridCellText(page: Page, r: number, col: number): Promise<string> {
  return page.evaluate(
    ({ r, col }) => {
      const el = document.querySelector(`[id*="calOrdtmChckGrid.body.gridrow_${r}.cell_${r}_${col}"]`);
      return el ? (el.textContent || "").trim() : "";
    },
    { r, col }
  );
}

// 과제명 칸에는 "...[(주관/공동)주관과제] 기관명 (사업자번호) [...]" 같은 형식으로
// 기관유형이 대괄호 안에 섞여 들어있다. 닫는 괄호 ")" 바로 뒤에 오는 2글자(주관/공동/위탁)만 뽑아낸다.
function extractOrgTypeFromTaskNameCell(text: string) {
  // 예: "...[(주관/공동)주관과제] 기관명 ..." -> "]" 앞 4글자("주관과제") 중 앞 2글자("주관")만 취한다.
  // 단, 과제명 안에 다른 대괄호(예: "[환자...]")가 먼저 나올 수 있으니,
  // 반드시 "과제]"로 끝나는 대괄호만 찾는다.
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf("]", searchFrom);
    if (idx === -1 || idx < 4) return "";
    const fourChars = text.slice(idx - 4, idx);
    if (fourChars.slice(2) === "과제") {
      return fourChars.slice(0, 2);
    }
    searchFrom = idx + 1;
  }
}

async function setInputValue(page: Page, selector: string, value: string) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Tab");
}

interface NetworkLogEntry {
  method: string;
  url: string;
  postData?: string;
  status?: number;
  body?: string;
  failed?: string;
}

// 2단계: 로그인 후 "정산 > 상시점검 > 상시점검 관리" 화면으로 이동한 상태에서 실행한다.
export async function runAutomation(
  rows: EzbaroRow[],
  onProgress: (line: string) => void,
  onBatchDone: (results: EzbaroResult[]) => void,
  shouldStop: () => boolean
): Promise<EzbaroResult[]> {
  if (!isBrowserOpen()) {
    throw new Error("브라우저가 열려있지 않습니다. 먼저 로그인을 진행해주세요.");
  }
  const { context, page } = getSession();
  resetCaptureRootForNewRun(); // 이번 실행에서 쓸 캡쳐 폴더 이름을 새로 확인한다.
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const results: EzbaroResult[] = [];

  // 상시점검 보고서 생성대상 여부 체크박스는 처음 한 번만 해제한다.
  const checkbox = await page.$(SEL.checkbox);
  if (checkbox) {
    const status = await checkbox.getAttribute("userstatus");
    if (status === "selected") {
      await checkbox.click();
      onProgress("상시점검 보고서 생성대상 여부 체크 해제 완료");
    }
  } else {
    onProgress("경고: 체크박스를 찾지 못했습니다. 상시점검 관리 화면이 맞는지 확인해주세요.");
  }

  // 기관명은 팝업을 열지 않고도 목록 화면(그리드)에 이미 나와있는 값을 그대로 쓴다 - 더 안정적이다.
  // 단, 성명(연구책임자)은 그리드 값과 팝업 안 값이 다를 수 있어서 반드시 팝업에서 가져온다.
  // 칸 순서가 바뀔 수 있으니 칸 번호가 아니라 이름으로 위치를 찾는다.
  const colTaskName = await getGridColumnIndex(page, "과제명");
  const colOrgName = await getGridColumnIndex(page, "연구수행기관");
  const colResearcher = await getGridColumnIndex(page, "연구책임자");

  for (let i = 0; i < rows.length; i++) {
    if (shouldStop()) {
      onProgress(`사용자 요청으로 중단합니다. (${i}/${rows.length}건까지 처리됨)`);
      break;
    }
    const { taskNo, year } = rows[i];
    onProgress(`[${i + 1}/${rows.length}] ${taskNo} (${year}) 조회 시작`);

    await setInputValue(page, SEL.taskNo, taskNo);
    await setInputValue(page, SEL.yearStart, year);
    await setInputValue(page, SEL.yearEnd, year);

    await page.click(SEL.searchBtn);

    // 결과 그리드의 행 개수를 센다. (칸 id에 "gridrow_숫자"가 들어있다)
    const readRowIndexes = () =>
      page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[id*="calOrdtmChckGrid.body.gridrow_"]'));
        const set = new Set<number>();
        cells.forEach((c) => {
          const m = c.id.match(/gridrow_(\d+)\.cell_\d+_0/);
          if (m) set.add(Number(m[1]));
        });
        return Array.from(set).sort((a, b) => a - b);
      });

    // 조회 결과가 늦게 뜰 수 있어서, 결과가 나오거나 최대 1분이 될 때까지 계속 확인한다.
    // (실제로 결과가 없는 과제일 수도 있으니 무한정 기다리지는 않는다)
    let rowIndexes = await readRowIndexes();
    const searchDeadline = Date.now() + 60000;
    while (rowIndexes.length === 0 && Date.now() < searchDeadline) {
      await page.waitForTimeout(1000);
      rowIndexes = await readRowIndexes();
    }

    if (rowIndexes.length === 0) {
      onProgress(`  -> 조회 결과 없음`);
      results.push({ taskNo, year, orgType: "", orgName: "", gridResearcher: "", name: "", phone: "", email: "", bizNo: "", note: "조회결과없음" });
      onBatchDone(results);
      continue;
    }

    for (const r of rowIndexes) {
      // 기관유형·기관명은 팝업을 열기 전에, 목록 화면(그리드)에서 먼저 읽어둔다.
      const taskNameCellText = colTaskName >= 0 ? await getGridCellText(page, r, colTaskName) : "";
      const orgType = extractOrgTypeFromTaskNameCell(taskNameCellText);
      const orgName = cleanOrgName(colOrgName >= 0 ? await getGridCellText(page, r, colOrgName) : "");
      // 팝업 안 "성명"(OCR)과 다를 수 있어서, 목록 화면의 연구책임자도 참고용으로 같이 저장한다.
      const gridResearcher = colResearcher >= 0 ? await getGridCellText(page, r, colResearcher) : "";

      const popupPromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);

      // 주의: page.evaluate로 el.click()을 부르면 "가짜 클릭"이라서 브라우저가
      // 팝업을 막아버린다. 반드시 Playwright의 진짜 클릭(마우스 이벤트)을 써야 한다.
      const cellSelector = `[id*="calOrdtmChckGrid.body.gridrow_${r}.cell_${r}_5"]`;
      await page.click(cellSelector, { timeout: 5000 }).catch(async () => {
        // 셀이 화면 밖에 있을 수 있으니 스크롤해서 보이게 한 뒤 한 번 더 시도한다.
        await page.locator(cellSelector).scrollIntoViewIfNeeded().catch(() => {});
        await page.click(cellSelector, { timeout: 5000 }).catch(() => {});
      });

      const popup = await popupPromise;
      if (!popup) {
        onProgress(`  -> ${r + 1}행 팝업이 열리지 않았습니다.`);
        results.push({ taskNo, year, orgType, orgName, gridResearcher, name: "", phone: "", email: "", bizNo: "", note: "팝업열림실패" });
        continue;
      }

      // 진단용: 팝업이 서버와 주고받는 통신을 전부 기록해서, 나중에 어떤 요청이
      // 거절당했는지/응답이 비었는지 확인할 수 있게 한다.
      const networkLog: NetworkLogEntry[] = [];
      popup.on("requestfinished", async (req) => {
        try {
          const res = await req.response();
          if (!res) return;
          let bodySnippet = "";
          try {
            const buf = await res.body();
            bodySnippet = buf.toString("utf-8").slice(0, 500);
          } catch {
            bodySnippet = "(응답 본문 못 읽음)";
          }
          networkLog.push({
            method: req.method(),
            url: req.url(),
            postData: (req.postData() || "").slice(0, 500),
            status: res.status(),
            body: bodySnippet,
          });
        } catch {
          // 무시
        }
      });
      popup.on("requestfailed", (req) => {
        networkLog.push({ method: req.method(), url: req.url(), failed: req.failure()?.errorText || "알수없음" });
      });

      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      await waitForDetailDataLoaded(popup);

      // "연구원 정보"는 화면 맨 아래까지 스크롤을 내려야만 데이터를 불러온다(사람이 직접 확인함).
      await popup.mouse.move(600, 400).catch(() => {});
      for (let k = 0; k < 25; k++) {
        await popup.mouse.wheel(0, 1500).catch(() => {});
        await popup.waitForTimeout(200);
      }
      await popup.keyboard.press("End").catch(() => {});
      await popup.waitForTimeout(300);

      await waitForDetailDataLoaded(popup, 10000);
      await popup.waitForTimeout(300); // 데이터가 채워진 뒤 화면이 마저 그려질 시간을 조금 더 준다.

      // 이메일·사업자번호는 코드(HTML)로 읽는 방식이 잘 되므로 그대로 쓴다.
      // 둘 중 하나는 사람/기관에 따라 원래 비어있을 수 있어서, 서로 독립적으로 판단한다.
      // 한 번 찾은 값은 다음 시도에서 다시 비어보여도 덮어쓰지 않고 계속 가지고 있는다.
      // 사업자등록번호는 항상 있는 값이라 끝까지(최대 60초) 기다려서라도 꼭 찾는다.
      // 이메일은 원래 없는 사람도 있어서, 어느 정도(4번) 시도해봤는데도 안 나오면
      // 이메일은 포기하고 사업자등록번호가 나올 때까지만 계속 기다린다.
      const info: DetailFields = { orgType: "", orgName: "", email: "", bizNo: "" };
      const MAX_ATTEMPTS = 30;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const attemptInfo = await readDetailFields(popup).catch(() => null);
        if (attemptInfo) {
          if (attemptInfo.orgType) info.orgType = attemptInfo.orgType;
          if (attemptInfo.orgName) info.orgName = attemptInfo.orgName;
          if (attemptInfo.email) info.email = attemptInfo.email;
          if (attemptInfo.bizNo) info.bizNo = attemptInfo.bizNo;
        }
        if (info.bizNo && (info.email || attempt >= 3)) break;
        await popup.waitForTimeout(2000);
      }

      // 성명·휴대폰은 HTML로는 시도하지 않고 오직 OCR로만 읽는다.
      const ocrResult = await ocrResearcherInfo(popup);
      const name = preferGridSpelling(ocrResult.name, gridResearcher);
      const phone = ocrResult.phone;
      const email = info.email || "";
      const bizNo = info.bizNo || "";

      // 사람이 눈으로 검증할 수 있도록 화면 사진을 남겨둔다 — 글자 인식에 쓴 바로 그 캡처를 저장해서
      // 결과가 이상하면 캡처와 그대로 대조할 수 있게 한다.
      // 다운로드 폴더 안에 과제번호별 폴더를 만들고, "과제번호_기관명.png"로 저장한다.
      // turbopackIgnore: 다운로드 폴더 경로라 프로그램에 넣을 파일이 아니다(빌드 도구가 프로젝트
      // 폴더 전체를 프로그램에 포함시키지 않도록 표시).
      const taskFolder = path.join(/*turbopackIgnore: true*/ captureRootDir(), sanitizeForFilename(taskNo));
      if (!fs.existsSync(/*turbopackIgnore: true*/ taskFolder)) fs.mkdirSync(taskFolder, { recursive: true });
      const previewFileName = `${sanitizeForFilename(taskNo)}_${sanitizeForFilename(orgName)}.png`;
      if (ocrResult.capture) {
        fs.writeFileSync(path.join(taskFolder, previewFileName), ocrResult.capture);
      } else {
        await popup.screenshot({ path: path.join(taskFolder, previewFileName) }).catch(() => {});
      }

      // 실제 화면 구조와 통신 기록, 글자 인식에 쓴 칸 이미지를 나중에 직접 들여다볼 수 있도록 저장해둔다 (디버그용).
      const debugBase = `${sanitizeForFilename(taskNo)}_${r}`;
      if (ocrResult.cells.name) fs.writeFileSync(path.join(DEBUG_DIR, `ocr_name_${debugBase}.png`), ocrResult.cells.name);
      if (ocrResult.cells.phone) fs.writeFileSync(path.join(DEBUG_DIR, `ocr_phone_${debugBase}.png`), ocrResult.cells.phone);
      const html = await popup.content().catch(() => null);
      if (html) {
        fs.writeFileSync(path.join(DEBUG_DIR, `popup_${sanitizeForFilename(taskNo)}_${r}.html`), html, "utf-8");
      }
      fs.writeFileSync(
        path.join(DEBUG_DIR, `network_${sanitizeForFilename(taskNo)}_${r}.json`),
        JSON.stringify(networkLog, null, 2),
        "utf-8"
      );

      await popup.close().catch(() => {});

      // 휴대폰·이메일은 사람에 따라 원래 없을 수 있어서 실패로 안 친다.
      // 성명(OCR)과 사업자등록번호(HTML)는 항상 있어야 정상이니, 이 둘이 다 비어있을 때만 "실패"로 본다.
      // 읽은 성명이 목록 화면의 연구책임자와 다르거나 비어 있으면, 사람이 캡처와 대조하도록 표시한다.
      const notes: string[] = [];
      if (!name && !bizNo) notes.push("항목추출실패");
      if (needsNameCheck(name, gridResearcher)) notes.push("이름 확인 필요");
      const note = notes.join(", ");
      if (notes.length) {
        onProgress(`  -> ${r + 1}행: ${orgName} / ${name || "(성명 못 읽음)"} / ${phone} / ${email} — ${note} [${ocrResult.debug}]`);
      } else {
        onProgress(`  -> ${r + 1}행: ${orgName} / ${name} / ${phone} / ${email}`);
      }
      results.push({ taskNo, year, orgType, orgName, gridResearcher, name, phone, email, bizNo, note });
    }

    onBatchDone(results);
  }

  await terminateOcrWorker();
  return results;
}

export async function confirmLoginAndNavigate(): Promise<void> {
  const session = getSession();
  const ezbaroPage = await findEzbaroPage(session.context);
  if (!ezbaroPage) {
    throw new Error(
      "로그인 후 이지바로(ezbaro.go.kr) 화면 탭을 찾지 못했습니다. GAIA에서 로그인 후 이지바로 화면이 새 탭으로 열렸는지 확인해주세요."
    );
  }
  // 이후 모든 자동화는 이 이지바로 탭을 기준으로 진행한다.
  session.page = ezbaroPage;
  await navigateToTargetScreen(ezbaroPage);
}
