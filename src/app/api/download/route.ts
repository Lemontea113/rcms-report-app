export const runtime = "nodejs";

import fs from "fs/promises";
import { NextResponse } from "next/server";
import { getDownloadDir, getState } from "@/lib/store";
import { buildResultWorkbookBuffer } from "@/lib/excel";

export async function GET() {
  const state = getState();
  // 엑셀은 이미 메모리에 있는 task.data만 사용해서 만든다 — 임시 HTML 파일은
  // 더 이상 필요 없으므로, 사용자가 다운로드 버튼을 눌러 이 요청이 온 시점에
  // 정리한다(있어도 그만, 없어도 그만인 임시 폴더라 실패해도 무시한다).
  const downloadDir = getDownloadDir();
  if (downloadDir) {
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }

  const buffer = await buildResultWorkbookBuffer(state.tasks);

  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const filename = `${y}${m}${d}_RCMS사용실적보고서.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
