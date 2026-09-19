import ExcelJS from "exceljs";
import type { TaskItem } from "./types";

const FIXED_HEADERS = [
  "연구개발과제번호",
  "연구개발기관 기관명",
  "연구책임자 성명",
  "총시작일",
  "총종료일",
  "단계시작일",
  "단계종료일",
  "당해시작일",
  "당해종료일",
];
const NOTE_HEADER = "비고";
const PARTNER_HEADER_BASE = "공동연구개발기관명";
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

export async function readTaskNumbers(buffer: Buffer, column = "과제번호"): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled Buffer typing can mismatch the project's @types/node version.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("엑셀 파일에 시트가 없습니다.");

  const headerRow = sheet.getRow(1);
  let colIndex = -1;
  headerRow.eachCell((cell, colNumber) => {
    if (String(cell.value ?? "").trim() === column) colIndex = colNumber;
  });
  if (colIndex === -1) {
    const actualHeaders: string[] = [];
    headerRow.eachCell((cell) => actualHeaders.push(String(cell.value ?? "")));
    throw new Error(`'${column}' 열을 찾을 수 없습니다. 실제 헤더: ${actualHeaders.join(", ")}`);
  }

  const numbers: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const value = row.getCell(colIndex).value;
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      numbers.push(String(value).trim());
    }
  });
  return numbers;
}

// OCR이 기간 값을 못 읽었거나(빈 문자열) 형식이 이상하면 null을 반환한다 — 이 경우
// 엑셀에서는 그 칸만 비워두고 "비고"에 표시할 뿐, 전체 다운로드가 실패하지 않게 한다.
function parsePeriod(period: string): [Date | null, Date | null] {
  const toDate = (s: string | undefined): Date | null => {
    if (!s) return null;
    const parts = s.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    const [y, m, d] = parts;
    // exceljs는 날짜를 엑셀 시리얼 값으로 바꿀 때 Date.getTime()(UTC 기준)을 그대로 쓴다.
    // 로컬 시간(new Date(y, m-1, d))으로 만들면 한국(UTC+9) 자정이 UTC로는 전날 15시가
    // 되어, 엑셀에 하루 앞선 날짜로 저장되는 버그가 있었다 — UTC 자정으로 만들어야 한다.
    return new Date(Date.UTC(y, m - 1, d));
  };
  const [startRaw, endRaw] = period.split("~").map((p) => p.trim());
  return [toDate(startRaw), toDate(endRaw)];
}

function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60);
    width += isWide ? 2 : 1;
  }
  return width;
}

function displayedText(value: ExcelJS.CellValue): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value === null || value === undefined ? "" : String(value);
}

export async function buildResultWorkbookBuffer(tasks: TaskItem[]): Promise<Buffer> {
  const successTasks = tasks.filter((t) => t.state === "완료" && t.data);
  const neededPartnerCols = successTasks.reduce((max, t) => {
    const count = (t.data!.partners || "").split(",").filter((p) => p.trim()).length;
    return Math.max(max, count);
  }, 0);

  const partnerHeaders = Array.from({ length: neededPartnerCols }, (_, i) =>
    i === 0 ? PARTNER_HEADER_BASE : `${PARTNER_HEADER_BASE}${i + 1}`
  );
  const header = [...FIXED_HEADERS, ...partnerHeaders, NOTE_HEADER];
  const noteColIndex = header.length;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("사용실적보고서");
  sheet.addRow(header);
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });

  for (const task of tasks) {
    if (task.state === "완료" && task.data) {
      const [totalStart, totalEnd] = parsePeriod(task.data.periodTotal);
      const [stageStart, stageEnd] = parsePeriod(task.data.periodStage);
      const [yearStart, yearEnd] = parsePeriod(task.data.periodYear);
      const dates = [totalStart, totalEnd, stageStart, stageEnd, yearStart, yearEnd];
      const partners = task.data.partners.split(",").map((p) => p.trim()).filter(Boolean);

      const row = sheet.addRow([
        task.data.projectNo,
        task.data.org,
        task.data.pi,
        ...dates,
        ...partners,
      ]);
      dates.forEach((date, i) => {
        if (date) row.getCell(4 + i).numFmt = "yyyy-mm-dd";
      });
      if (dates.some((d) => d === null)) {
        row.getCell(noteColIndex).value = "일부 기간 항목을 인식하지 못했습니다 (원본 보고서 확인 필요)";
      }
    } else {
      const row = sheet.addRow([task.projectNo]);
      row.getCell(noteColIndex).value =
        task.state === "대기중" ? "미처리 (중단됨)" : `조회 실패: ${task.error ?? "알 수 없는 오류"}`;
    }
  }

  sheet.columns.forEach((column, index) => {
    let maxWidth = displayWidth(header[index] ?? "");
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      maxWidth = Math.max(maxWidth, displayWidth(displayedText(cell.value)));
    });
    column.width = maxWidth + 2;
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
