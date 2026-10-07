import ExcelJS from "exceljs";
import type { EzbaroResult, EzbaroRow } from "./store";

// 업로드 엑셀: 1열 과제번호, 2열 년도 (1행은 제목행으로 보고 건너뛴다)
export async function readEzbaroRows(buffer: Buffer): Promise<EzbaroRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs's bundled Buffer typing can mismatch the project's @types/node version.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("엑셀 파일에 시트가 없습니다.");
  const rows: EzbaroRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const taskNo = row.getCell(1).text?.trim();
    const year = row.getCell(2).text?.trim();
    if (taskNo && year) rows.push({ taskNo, year });
  });
  return rows;
}

export function ezbaroOutputFileName(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_이지바로_연구책임자정보.xlsx`;
}

const HEADERS = ["과제번호", "기관구분", "기관명", "사업자등록번호", "연구책임자", "성명(팝업)", "휴대폰", "이메일", "비고"];

// 제목열 포함해서 내용 길이에 맞게 너비를 정한다 (한글은 영문보다 넓게 계산한다)
function visualWidth(text: unknown): number {
  let w = 0;
  for (const ch of String(text)) {
    w += /[ㄱ-힝]/.test(ch) ? 2 : 1;
  }
  return w;
}

export async function buildEzbaroWorkbookBuffer(results: EzbaroResult[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("결과");
  sheet.addRow(HEADERS);
  for (const r of results) {
    sheet.addRow([r.taskNo, r.orgType, r.orgName, r.bizNo, r.gridResearcher, r.name, r.phone, r.email, r.note]);
  }

  // 제목행: 배경색 RGB(217,217,217)
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    cell.font = { bold: true };
  });

  sheet.columns.forEach((column, idx) => {
    let maxLen = visualWidth(HEADERS[idx] ?? "");
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      maxLen = Math.max(maxLen, visualWidth(cell.value ?? ""));
    });
    column.width = maxLen + 4;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
