import path from "path";
import type { Page } from "playwright";
import { getSession } from "./session";
import { addLog } from "./store";

// 실패했을 때 그 순간 화면을 캡처해 로그에 같이 남기기 위한 에러 타입.
export class AutomationError extends Error {
  screenshotPath?: string;
  constructor(message: string, screenshotPath?: string) {
    super(message);
    this.name = "AutomationError";
    this.screenshotPath = screenshotPath;
  }
}

/**
 * RCMS 과제번호 조회 → 사용실적보고서 화면 → HTML로 저장(1페이지만), 과제번호 1건 처리.
 *
 * NOTE (실제 화면에서 한 번 같이 검증 필요): 아래 선택자는 지금까지 확인된 화면 설명을 바탕으로
 * 텍스트 기반으로 최대한 유연하게 작성했지만, 실제 메뉴 위치·버튼 문구가 다르면 조정이 필요하다.
 *
 * RCMS는 "버튼"처럼 보이는 요소가 실제로는 <button>이 아니라 <a> 태그나 이미지인 경우가 많다
 * (R&D전문기관 타일도 그랬다). 그래서 getByRole("button", ...)에 의존하지 않고, 태그 종류와
 * 무관하게 화면에 보이는 글자로 직접 찾아 클릭한다.
 */
// NOTE: 같은 글자가 화면에 안 보이는 요소에도 들어있는 경우가 많다(예: 팝업 안에 미리
// 숨겨둔 "오류" 창의 "확인" 링크가 DOM 순서상 저장 창의 "확인" 버튼보다 앞에 있다).
// 그냥 first()를 쓰면 그 숨은 요소를 집고 "보일 때까지" 기다리다 타임아웃 나므로,
// 반드시 "화면에 보이는 것들 중 첫 번째"로 좁혀서 찾는다.
async function clickByText(page: Page, text: string, exact = true) {
  const locator = page.getByText(text, { exact }).filter({ visible: true }).first();
  await locator.waitFor({ state: "visible", timeout: 10000 });
  await locator.click();
}

// RCMS 로그인 직후 화면에서 "R&D전문기관" 타일을 눌러야 과제번호 조회 화면(pm.rcms.go.kr)으로 들어간다.
// javascript:void(null) 링크라 클릭으로만 동작하며, 배치당 한 번만 수행하면 된다.
export async function enterRndInstitutionPortal(page: Page) {
  addLog("R&D전문기관 화면으로 이동 중...");
  await clickByText(page, "R&D전문기관", false);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  addLog("R&D전문기관 화면 진입 완료");
}

async function fillProjectNo(page: Page, projectNo: string) {
  addLog(`과제번호 "${projectNo}" 입력 중...`);
  // "과제번호" 라는 글자 뒤의 입력칸이 실제로는 2개(검색창 하나, 결과 표 안에 숨어있는
  // 그리드 편집용 입력칸 하나) 있어서 그냥 찾으면 어느 쪽인지 몰라 에러가 난다.
  // 검색창의 실제 id는 "..._SRCH_..." 패턴이라 이걸로 정확히 짚는다.
  const searchInput = page.locator('input[id*="SRCH_PMS_SBJT_ID"]');
  if (await searchInput.count()) {
    await searchInput.first().fill(projectNo);
    return;
  }
  // 위 id 패턴을 못 찾으면(화면이 다르면) 기존 방식으로 대체하되, 여러 개면 첫 번째만 쓴다.
  const fallback = page.locator("text=과제번호").locator("xpath=following::input[1]").first();
  await fallback.fill(projectNo);
}

async function setTwoYearsAgoFilter(page: Page) {
  addLog('조회조건을 "2년전"으로 설정 중...');
  await clickByText(page, "2년전");
}

async function clickSearch(page: Page) {
  addLog("조회 버튼 클릭...");
  await clickByText(page, "조회");
}

// 결과 표(예: "연구비 상시점검 목록")는 w2grid 계열의 가상 스크롤 그리드로 보인다 —
// 화면에 실제로 안 보이는 "재활용 버퍼" 행(w2grid_hidedRow 등)이 tbody tr DOM 순서에
// 섞여 있어서, 단순히 "마지막 tr"을 찾으면 화면에 없는 숨겨진 행을 클릭하려다 타임아웃 난다.
// 그래서 순서가 아니라 "실제로 화면에 보이는 행들 중 Y좌표가 가장 큰(=가장 아래) 행"을 찾는다.
async function selectBottomRow(page: Page, projectNo: string) {
  addLog("조회 결과 목록을 찾는 중...");
  const table = page
    .locator("table")
    .filter({ has: page.locator("th, td", { hasText: "과제번호" }) })
    .filter({ visible: true })
    .first();
  await table.waitFor({ state: "visible", timeout: 10000 });

  // 직전 과제번호의 조회 결과가 아직 남아있는 상태에서 다음 과제를 처리하면 엉뚱한 행을
  // 집을 수 있다 — 이번 과제번호가 실제로 목록에 나타날 때까지 기다린 뒤에 진행한다.
  await table
    .locator("td", { hasText: projectNo })
    .first()
    .waitFor({ state: "visible", timeout: 15000 });

  const box = await table.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }

  addLog("가장 아래 과제까지 스크롤 중...");
  // 가상 스크롤 그리드는 행 개수로 "끝까지 스크롤했는지"를 판단할 수 없다 — 무조건 여러 번
  // 휠 스크롤을 반복해 맨 아래까지 내린다.
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(400);
  }

  const visibleRows = table.locator("tbody tr:visible");
  const count = await visibleRows.count();
  if (count === 0) throw new Error("조회 결과 목록이 비어 있습니다.");

  let bottomRow = visibleRows.first();
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const row = visibleRows.nth(i);
    const rowBox = await row.boundingBox();
    if (rowBox && rowBox.y > maxY) {
      maxY = rowBox.y;
      bottomRow = row;
    }
  }

  await bottomRow.scrollIntoViewIfNeeded().catch(() => {});

  addLog("가장 아래 과제 행 클릭...");
  // 행 전체(<tr>)의 가운데를 클릭하면 표가 옆으로 넓어서(가로 스크롤) 화면 밖 지점을
  // 클릭하게 될 수 있다 — 실제로 보이는, 과제번호가 적힌 칸을 직접 찾아 클릭한다.
  // 이 칸이 없다는 건 다른 과제의 행을 집었다는 뜻이므로, 그냥 아무 칸이나 누르지 않고
  // 실패로 알린다(엉뚱한 과제의 보고서를 받아 성공으로 기록되는 걸 막는다).
  const projectNoCell = bottomRow.locator("td", { hasText: projectNo }).first();
  if ((await projectNoCell.count()) === 0) {
    throw new Error(
      `조회 결과의 가장 아래 행에서 과제번호 "${projectNo}"를 찾지 못했습니다. 다른 과제의 행일 수 있어 중단합니다.`
    );
  }
  await projectNoCell.click();
}

async function openUsageReportPopup(page: Page): Promise<Page> {
  addLog('"사용실적보고서" 버튼 클릭, 팝업 여는 중...');
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    clickByText(page, "사용실적보고서"),
  ]);
  await popup.waitForLoadState("domcontentloaded");

  // "오즈 리포트 뷰어를 실행하고 있습니다" 로딩 창이 뜨는 동안은 저장 버튼이 아직 없거나
  // 화면이 덜 그려진 상태다 — 고정 시간만 기다리지 않고, 이 로딩 창이 실제로 사라질 때까지 기다린다.
  addLog("오즈 리포트 뷰어 로딩 대기 중...");
  const loadingDialog = popup.getByText("오즈 리포트 뷰어를 실행하고 있습니다");
  try {
    await loadingDialog.waitFor({ state: "visible", timeout: 5000 });
    await loadingDialog.waitFor({ state: "hidden", timeout: 30000 });
  } catch {
    // 로딩 창이 아예 안 뜨거나 너무 빨리 사라졌으면 그냥 넘어간다.
  }
  await popup.waitForTimeout(1000);
  addLog("사용실적보고서 화면 열림");

  await goToFirstPage(popup);
  return popup;
}

// 이전 과제번호 처리 중 뷰어가 다른 페이지로 넘어가 있었을 수 있어서(실제로 2페이지 상태로
// 저장 창이 뜬 적이 있었다), 저장하기 전에 항상 1페이지로 강제 이동해서 확실히 맞춘다.
async function goToFirstPage(popup: Page): Promise<void> {
  addLog("1페이지로 이동 확인 중...");
  // "저장" 버튼 때와 마찬가지로 role 매칭이 실제 자동화 환경에서 안 먹힐 수 있어, 툴바에서
  // 가장 먼저 나오는 일반 텍스트 입력칸(현재 페이지 번호칸)을 직접 짚는다.
  const pageInput = popup.locator('input[type="text"]').filter({ visible: true }).first();
  await pageInput.waitFor({ state: "visible", timeout: 10000 });
  await pageInput.fill("1");
  await pageInput.press("Enter");
  await popup.waitForTimeout(500);
}

// 파일 형식 드롭다운은 진짜 <select>다(접근성 트리에서 combobox "Web Page(*.html)"로 확인됨).
// 이전에 다른 형식(PDF 등)으로 저장했던 적이 있으면 그 값이 남아있을 수 있어서, 그냥 믿고
// 넘어가지 않고 매번 "Web Page(*.html)"로 명시적으로 선택한다. 같은 팝업 안에 확대/축소
// 비율(%) 드롭다운도 <select>라서, "Web Page"가 옵션에 있는 select로 정확히 짚는다.
const SAVE_FORMAT_HTML_LABEL = "Web Page(*.html)";

async function ensureSaveFormatIsHtml(popup: Page): Promise<void> {
  addLog("저장 형식을 HTML로 지정하는 중...");
  const formatSelect = popup
    .locator("select")
    .filter({ has: popup.locator("option", { hasText: "Web Page" }) })
    .filter({ visible: true })
    .first();
  await formatSelect.waitFor({ state: "visible", timeout: 10000 });
  await formatSelect.selectOption({ label: SAVE_FORMAT_HTML_LABEL });
  addLog("저장 형식 HTML로 지정 완료");
}

// 저장 버튼 클릭 → 형식을 HTML로 지정 → 다운로드.
// NOTE: "저장 옵션"(페이지 범위) 창 안의 "페이지 지정" 같은 항목들은 실제
// <input type=radio>/<input type=text>가 아니라 이름 없는 커스텀 버튼이라 안정적으로
// 클릭해 바꾸기 어렵다. 그래서 저장 범위는 직접 고르지는 않고, 매번 확인된 기본값
// ("페이지 지정: 1")을 그대로 쓴다 — 이 팝업은 항상 1페이지를 보고 있는 상태로만 열리므로
// "현재/기본 상태 그대로 저장"이면 always 1페이지가 된다.
async function downloadUsageReportHtml(popup: Page, downloadDir: string, projectNo: string): Promise<string> {
  addLog('"저장" 버튼 클릭...');
  // 접근성 트리에는 role="textbox" name="저장"으로 보이지만(이미지 버튼), 실제 자동화
  // 환경에서는 그 역할 매칭이 안 먹힐 수 있어 alt/title 속성으로 직접 찾는다.
  const saveBtn = popup
    .locator('[alt="저장"], [title="저장"], input[type="image"][alt*="저장"]')
    .filter({ visible: true })
    .first();
  await saveBtn.waitFor({ state: "visible", timeout: 20000 });
  await saveBtn.click();

  // 저장 창이 실제로 떴는지 확인 (제목이 정확히 "저장"인 요소)
  await popup
    .getByText("저장", { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: 10000 });

  await ensureSaveFormatIsHtml(popup);

  addLog("다운로드 대기 중...");
  const [download] = await Promise.all([
    popup.waitForEvent("download", { timeout: 30000 }),
    clickByText(popup, "확인"), // 저장 다이얼로그 확인(기본값 그대로) → 실제 다운로드
  ]);

  const filePath = path.join(downloadDir, `${projectNo}.html`);
  await download.saveAs(filePath);
  addLog(`HTML 파일 저장됨: ${filePath}`);
  return filePath;
}

async function captureFailureScreenshot(target: Page, downloadDir: string, projectNo: string): Promise<string | undefined> {
  try {
    const filePath = path.join(downloadDir, `${projectNo}_실패.png`);
    await target.screenshot({ path: filePath });
    addLog(`실패 시점 화면을 캡처했습니다: ${filePath}`);
    return filePath;
  } catch {
    return undefined; // 캡처 자체가 실패하면(예: 페이지가 이미 닫힘) 그냥 넘어간다.
  }
}

// 과제번호 1건에 대해 RCMS 화면을 조작해 사용실적보고서를 띄우고, HTML(1페이지)로 저장해
// 그 파일 경로를 반환한다. 실패하면 그 순간 화면을 캡처해 AutomationError에 담아 던진다.
// applyFilter: "2년전" 조회조건은 한 번 선택하면 다음 조회부터도 그대로 유지되므로,
// 배치의 첫 과제번호에서만 true로 넘겨 클릭하고 이후 과제번호에서는 생략한다.
export async function downloadReportForProject(
  projectNo: string,
  downloadDir: string,
  applyFilter: boolean
): Promise<string> {
  const { page } = getSession();
  let popup: Page | null = null;

  addLog(`── 과제번호 "${projectNo}" 처리 시작 ──`);
  try {
    await fillProjectNo(page, projectNo);
    if (applyFilter) {
      await setTwoYearsAgoFilter(page);
    }
    await clickSearch(page);
    await page.waitForTimeout(1000);
    await selectBottomRow(page, projectNo);

    popup = await openUsageReportPopup(page);
    return await downloadUsageReportHtml(popup, downloadDir, projectNo);
  } catch (err) {
    // 팝업이 열려 있었다면 그 화면을(사용실적보고서/저장 창), 아니면 조회 화면을 캡처한다.
    const target = popup && !popup.isClosed() ? popup : page;
    const screenshotPath = await captureFailureScreenshot(target, downloadDir, projectNo);
    throw new AutomationError(err instanceof Error ? err.message : String(err), screenshotPath);
  } finally {
    if (popup) await popup.close().catch(() => {});
  }
}
