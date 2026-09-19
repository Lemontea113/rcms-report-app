export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { addLog, resetState } from "@/lib/store";
import { openLoginBrowser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { projectNos } = (await req.json()) as { projectNos?: string[] };
  if (!Array.isArray(projectNos) || projectNos.length === 0) {
    return NextResponse.json({ error: "과제번호 목록이 없습니다." }, { status: 400 });
  }

  resetState(projectNos);
  addLog(`과제번호 ${projectNos.length}건을 불러왔습니다. RCMS 로그인 창을 여는 중...`);

  try {
    await openLoginBrowser();
    addLog("RCMS 로그인 페이지가 열렸습니다. 로그인 후 '로그인 완료'를 눌러주세요.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`RCMS 로그인 창을 여는 데 실패했습니다: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
