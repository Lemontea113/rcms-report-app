// 이지바로 팝업의 성명·휴대폰을 글자 인식(OCR)으로 읽는다.
//
// 방식: 팝업 화면을 한 장 캡처하고(이 캡처가 그대로 다운로드 폴더에 저장된다), 그 캡처에서
// "성명"·"휴대폰" 옆의 값 입력칸만 잘라낸 뒤, 글자 높이를 항상 같은 크기로 맞춰서 한 줄씩 읽는다.
//
// 예전에는 화면 가로 전체를 한 번에 읽었는데, 표 테두리·다른 칸 글자가 섞여서 통째로 실패하는
// 일이 많았고, 결과가 PC의 화면 배율(100%/125%/150%...)에 따라 크게 달라졌다. 값 칸만 잘라
// 같은 크기로 맞추면 화면 배율과 상관없이 같은 결과가 나온다.
//
// 주의: 이 파일은 실험 스크립트에서도 Node.js로 직접 불러 쓰므로, 타입 표기만 쓰고
// enum 같은 TypeScript 전용 문법은 쓰지 않는다.

import type { ElementHandle, Page } from "playwright";
import sharp from "sharp";
import { PSM, type Worker } from "tesseract.js";

const CELL_TARGET_HEIGHT = 96; // 잘라낸 값 칸을 이 높이(px)로 맞춘다 — 화면 배율과 무관하게 같은 크기로 읽기 위함
const CELL_INSET = 2; // 입력칸 테두리 선을 글자로 읽지 않도록 안쪽으로 조금 들여 자른다
const QUIET_MARGIN = 24; // 글자 주변에 흰 여백을 붙여 주면 한 줄 인식이 안정적이다

// 이름 칸: 한글·영문(띄어쓰기 포함)은 인정하고, 숫자·특수기호만 후보에서 뺀다.
const NAME_BLACKLIST = "0123456789|_-=+[]{}()<>/\\.,:;'\"`~!@#$%^&*?";
// 휴대폰 칸: 숫자와 "-"만 읽는다.
const PHONE_WHITELIST = "0123456789-";

export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Capture {
  image: Buffer; // 팝업 화면 캡처(PNG)
  pxPerCss: number; // 캡처 이미지 픽셀 / 화면 좌표(CSS px) 비율 = 그 PC의 화면 배율
}

// 라벨("성명" 등)과 같은 줄, 오른쪽에 있는 화면에 보이는 값 입력칸을 찾는다.
// 같은 라벨이 여러 곳에 있을 수 있어(예: 숨겨진 섹션) 보이는 것만 대상으로 한다.
export async function findValueCell(page: Page, label: string): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle((label) => {
    function visible(el: Element) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const labels = Array.from(document.querySelectorAll(".sta_WF_detailL")).filter(
      (el) => visible(el) && (el.textContent || "").trim() === label
    );
    for (const lab of labels) {
      const lr = lab.getBoundingClientRect();
      const cy = lr.y + lr.height / 2;
      const cells = Array.from(document.querySelectorAll("input.nexainput"))
        .filter((el) => visible(el))
        .map((el) => el.closest(".Edit") || el.parentElement || el)
        .filter((w) => {
          const r = w.getBoundingClientRect();
          return Math.abs(r.y + r.height / 2 - cy) < 10 && r.x >= lr.x + lr.width - 5;
        })
        .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
      if (cells.length) return cells[0];
    }
    return null;
  }, label);
  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    return null;
  }
  return el as ElementHandle<Element>;
}

// 팝업 화면을 한 장 캡처한다. 이 캡처를 다운로드 폴더에도 저장하므로, 사람이 보는 캡처와
// 글자 인식에 쓴 사진이 같다.
export async function captureScreen(page: Page): Promise<Capture> {
  const image = await page.screenshot();
  const { width = 0 } = await sharp(image).metadata();
  const cssWidth = await page.evaluate(() => window.innerWidth);
  return { image, pxPerCss: cssWidth > 0 ? width / cssWidth : 1 };
}

// 캡처에서 값 칸만 잘라낸다. 칸이 캡처 범위 밖이면(작은 화면이라 칸이 아래로 벗어나 있고,
// 이지바로 화면은 일반 웹페이지처럼 스크롤되지 않는 구조일 때) 그 칸만 따로 찍는다.
async function cropCell(capture: Capture, cell: ElementHandle<Element>, box: CellBox): Promise<Buffer> {
  const { width: imgW = 0, height: imgH = 0 } = await sharp(capture.image).metadata();
  const s = capture.pxPerCss;
  const left = Math.round((box.x + CELL_INSET) * s);
  const top = Math.round((box.y + CELL_INSET) * s);
  const width = Math.round((box.width - CELL_INSET * 2) * s);
  const height = Math.round((box.height - CELL_INSET * 2) * s);
  if (left >= 0 && top >= 0 && width > 0 && height > 0 && left + width <= imgW && top + height <= imgH) {
    return sharp(capture.image).extract({ left, top, width, height }).png().toBuffer();
  }
  const shot = await cell.screenshot();
  const meta = await sharp(shot).metadata();
  const inset = Math.round(CELL_INSET * ((meta.width ?? 1) / box.width));
  return sharp(shot)
    .extract({
      left: inset,
      top: inset,
      width: Math.max(1, (meta.width ?? 1) - inset * 2),
      height: Math.max(1, (meta.height ?? 1) - inset * 2),
    })
    .png()
    .toBuffer();
}

// 잘라낸 칸을 화면 배율과 상관없이 같은 글자 크기로 맞춘다.
async function normalizeCell(cell: Buffer): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(cell).metadata();
  const scale = CELL_TARGET_HEIGHT / height;
  return sharp(cell)
    .resize({ width: Math.max(1, Math.round(width * scale)), height: CELL_TARGET_HEIGHT, kernel: "lanczos3" })
    .grayscale()
    .normalize()
    .extend({
      top: QUIET_MARGIN,
      bottom: QUIET_MARGIN,
      left: QUIET_MARGIN,
      right: QUIET_MARGIN,
      background: "#ffffff",
    })
    .png()
    .toBuffer();
}

async function recognizeLine(
  worker: Worker,
  image: Buffer,
  chars: { whitelist?: string; blacklist?: string }
): Promise<string> {
  // 설정은 worker에 남아 있으므로 매번 두 값을 모두 명시해 이전 칸의 설정이 섞이지 않게 한다.
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: chars.whitelist ?? "",
    tessedit_char_blacklist: chars.blacklist ?? "",
  });
  const result = await worker.recognize(image);
  return (result.data.text || "").trim();
}

// 이름: 한글 이름이면 한글만 이어 붙이고(글자 사이에 끼어든 공백 제거),
// 영문 이름이면 단어 사이 띄어쓰기를 한 칸으로 정리해 그대로 둔다.
export function cleanName(text: string): string {
  const letters = text.replace(/[^A-Za-z가-힣\s]/g, " ").replace(/\s+/g, " ").trim();
  const hangul = letters.replace(/[^가-힣]/g, "");
  if (hangul.length >= 2 && hangul.length <= 10) return hangul;
  const english = letters.replace(/[^A-Za-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (english.replace(/\s/g, "").length >= 2) return english;
  return "";
}

export function cleanPhone(text: string): string {
  const m = text.replace(/\s+/g, "").match(/0\d{1,2}-?\d{3,4}-?\d{4}/);
  return m ? m[0] : "";
}

const normalizeName = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// 목록 화면의 연구책임자 이름과 팝업에서 읽은 성명을 대조한다(띄어쓰기·대소문자 무시).
// 못 읽었거나 서로 다르면 사람이 확인해야 한다. 목록에 이름이 없으면 대조할 수 없으니 넘어간다.
export function needsNameCheck(ocrName: string, gridName: string): boolean {
  if (!ocrName) return true;
  if (!gridName.trim()) return false;
  return normalizeName(ocrName) !== normalizeName(gridName);
}

// 글자 인식은 영문 이름의 띄어쓰기를 가끔 놓친다("Lee JiEun"). 띄어쓰기·대소문자만 다르고
// 목록 이름과 같은 이름이면, 표기는 목록 화면의 것을 따른다.
export function preferGridSpelling(ocrName: string, gridName: string): string {
  if (ocrName && gridName.trim() && normalizeName(ocrName) === normalizeName(gridName)) return gridName.trim();
  return ocrName;
}

export interface ResearcherOcrResult {
  name: string;
  phone: string;
  capture: Buffer | null; // 다운로드 폴더에 저장할 캡처(글자 인식에 쓴 바로 그 사진)
  cells: { name?: Buffer; phone?: Buffer }; // 진단용: 실제로 읽은 칸 이미지
  debug: string;
}

export async function readResearcherInfo(page: Page, worker: Worker): Promise<ResearcherOcrResult> {
  const nameCell = await findValueCell(page, "성명");
  if (!nameCell) {
    return { name: "", phone: "", capture: null, cells: {}, debug: "성명 입력칸을 찾지 못함" };
  }
  // 작은 화면에서는 연구원 정보 칸이 화면 아래로 벗어나 있을 수 있어, 캡처 전에 보이게 한다.
  await nameCell.scrollIntoViewIfNeeded().catch(() => {});
  const phoneCell = await findValueCell(page, "휴대폰");

  const capture = await captureScreen(page);
  const cells: ResearcherOcrResult["cells"] = {};
  const notes: string[] = [`배율 ${Math.round(capture.pxPerCss * 100)}%`];

  let name = "";
  const nameBox = await nameCell.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  if (nameBox && nameBox.y + nameBox.height > viewportHeight) {
    // 화면 맨 아래까지 스크롤한 뒤에도 칸이 창 밖이면, 창이 너무 작아 칸이 그려지지 않았을 수 있다.
    notes.push("성명 칸이 화면 밖에 있음(창을 최대화해 주세요)");
  }
  if (nameBox) {
    cells.name = await normalizeCell(await cropCell(capture, nameCell, nameBox));
    const raw = await recognizeLine(worker, cells.name, { blacklist: NAME_BLACKLIST });
    name = cleanName(raw);
    notes.push(`성명원문="${raw}"`);
  }

  let phone = "";
  const phoneBox = phoneCell ? await phoneCell.boundingBox() : null;
  if (phoneCell && phoneBox) {
    cells.phone = await normalizeCell(await cropCell(capture, phoneCell, phoneBox));
    const raw = await recognizeLine(worker, cells.phone, { whitelist: PHONE_WHITELIST });
    phone = cleanPhone(raw);
    notes.push(`휴대폰원문="${raw}"`);
  } else {
    notes.push("휴대폰 입력칸을 찾지 못함");
  }

  await nameCell.dispose();
  await phoneCell?.dispose();
  return { name, phone, capture: capture.image, cells, debug: notes.join(" ") };
}
