import fs from "fs/promises";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import type { ReportData } from "./types";

/**
 * RCMS "사용실적보고서" 팝업에서 "저장 → Web Page(*.html) → 페이지 지정: 1"로 받은 HTML
 * 파일에서 값을 읽는다.
 *
 * 이 내보내기는 일반 <table>이 아니라, 칸(셀) 하나하나가 절대좌표(left/top, px)를 가진
 * <div>로 따로 떨어져 있는 "인쇄 레이아웃 재현" 방식이다(OZ 리포트 뷰어의 HTML 내보내기
 * 특징). 그래서 같은 시각적 줄(row)에 있는 칸들은 top 값이 서로 비슷하고, 그 줄 안에서는
 * left 값 순서(왼쪽→오른쪽)가 읽는 순서다 — 이 성질을 이용해 줄을 재구성한 뒤, 라벨 다음
 * 칸을 값으로 읽는다.
 *
 * 또한 이 파일은 <meta charset> 선언이 없고 실제 인코딩이 EUC-KR이라(UTF-8 아님),
 * 그대로 읽으면 한글이 깨진다 — UTF-8로 읽어봐서 한글이 안 보이면 EUC-KR로 다시 읽는다.
 */

function decodeHtmlBuffer(buffer: Buffer): string {
  // "UTF-8로 읽어서 한글이 보이면 UTF-8" 판정은 못 믿는다 — EUC-KR 바이트를 UTF-8로 잘못
  // 해석해도 우연히 유효한(그러나 틀린) 한글 완성형 문자가 만들어질 수 있기 때문이다.
  // 대신 <meta charset=...> 선언을 직접 찾는다. 선언이 없으면(실제 RCMS 내보내기가 이랬다)
  // EUC-KR로 본다.
  const asciiPeek = buffer.subarray(0, 2000).toString("ascii");
  const declared = asciiPeek.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (declared === "utf-8" || declared === "utf8") {
    return buffer.toString("utf-8");
  }
  return iconv.decode(buffer, "euc-kr");
}

interface PositionedText {
  left: number;
  top: number;
  text: string;
}

function collectPositionedTexts(html: string): PositionedText[] {
  const $ = cheerio.load(html);
  const positioned = "div[style*='left:'][style*='top:']";

  // 저장 범위 기본값이 "전체 페이지"라 보고서 49페이지가 한 파일에 다 들어있다.
  // 페이지마다 좌표(top)가 0부터 다시 시작하기 때문에 파일 전체를 훑으면 다른 페이지의
  // 글자가 같은 줄로 섞여버린다 — 페이지 컨테이너(position:relative 인 div)는 페이지당
  // 하나씩 있으므로, 그 중 첫 번째(=1페이지) 안에서만 글자를 모은다.
  const firstPage = $("div[style*='position:relative']").first();
  const scope = firstPage.length > 0 ? firstPage : $("body");

  const items: PositionedText[] = [];
  scope.find(positioned).each((_, el) => {
    // 칸들을 묶는 중간 컨테이너 div도 같은 선택자에 걸려서 그 안의 글자를 전부 합쳐버린다
    // — 안에 다른 좌표 div를 담고 있지 않은 "최종 칸"만 남긴다.
    if ($(el).find(positioned).length > 0) return;

    const style = $(el).attr("style") || "";
    const leftMatch = style.match(/left:(-?\d+)px/);
    const topMatch = style.match(/top:(-?\d+)px/);
    if (!leftMatch || !topMatch) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    items.push({ left: parseInt(leftMatch[1], 10), top: parseInt(topMatch[1], 10), text });
  });
  return items;
}

// top이 정확히 같지 않아도(1~2px 오차) 같은 줄로 본다.
const ROW_TOP_TOLERANCE = 3;

function groupIntoRows(items: PositionedText[]): string[][] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: { top: number; items: PositionedText[] }[] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r.top - item.top) <= ROW_TOP_TOLERANCE);
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ top: item.top, items: [item] });
    }
  }
  return rows.map((r) => r.items.sort((a, b) => a.left - b.left).map((i) => i.text));
}

function findRowIndex(rows: string[][], label: string, searchFrom = 0): number {
  for (let i = searchFrom; i < rows.length; i++) {
    if (rows[i].some((c) => c.includes(label))) return i;
  }
  return -1;
}

function findValueAfterLabel(rows: string[][], label: string, searchFrom = 0, searchTo = -1): string {
  const end = searchTo === -1 ? rows.length : Math.min(searchTo, rows.length);
  for (let i = searchFrom; i < end; i++) {
    const cells = rows[i];
    const idx = cells.findIndex((c) => c.includes(label));
    // 라벨과 값은 항상 다른 칸에 있다(라벨 칸 안에 "해당 단계 (해당 시 작성)"처럼 부가
    // 설명이 붙어 있어도 그건 라벨의 일부다) — 그래서 항상 다음 칸을 값으로 본다.
    if (idx !== -1 && cells[idx + 1]) {
      return cells[idx + 1].trim();
    }
  }
  return "";
}

// "기관명"/"성명" 같은 짧은 라벨은 문서 뒤쪽(다른 표, 서명란)에도 등장할 수 있어서, 구획
// 헤더 바로 다음 몇 줄 안에서만 찾는다.
const SECTION_WINDOW = 5;

export function parseReportHtml(html: string, fallbackProjectNo: string): ReportData {
  const rows = groupIntoRows(collectPositionedTexts(html));

  const projectNo = findValueAfterLabel(rows, "연구개발과제번호") || fallbackProjectNo;

  const orgSectionStart = findRowIndex(rows, "연구개발기관");
  const org =
    orgSectionStart === -1
      ? ""
      : findValueAfterLabel(rows, "기관명", orgSectionStart, orgSectionStart + SECTION_WINDOW);

  const piSectionStart = findRowIndex(rows, "연구책임자");
  const pi =
    piSectionStart === -1
      ? ""
      : findValueAfterLabel(rows, "성명", piSectionStart, piSectionStart + SECTION_WINDOW);

  const periodSectionStart = findRowIndex(rows, "연구개발기간");
  const periodEnd = periodSectionStart === -1 ? -1 : periodSectionStart + SECTION_WINDOW;
  const base = Math.max(periodSectionStart, 0);
  const periodTotal = findValueAfterLabel(rows, "전체", base, periodEnd);
  const periodStage = findValueAfterLabel(rows, "해당", base, periodEnd);
  const periodYear = findValueAfterLabel(rows, "현재", base, periodEnd);

  const partnersRaw = findValueAfterLabel(rows, "공동연구개발기관명");
  const partners = partnersRaw === "" || partnersRaw.includes("없음") ? "" : partnersRaw;

  return { projectNo, org, pi, periodTotal, periodStage, periodYear, partners };
}

export async function parseReportHtmlFile(filePath: string, fallbackProjectNo: string): Promise<ReportData> {
  const buffer = await fs.readFile(filePath);
  const html = decodeHtmlBuffer(buffer);
  return parseReportHtml(html, fallbackProjectNo);
}
