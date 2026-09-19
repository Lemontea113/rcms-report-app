export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { addLog } from "@/lib/store";
import { runBatch } from "@/lib/runBatch";

export async function POST() {
  addLog("로그인 완료 확인. 자동 조회를 시작합니다.");
  // 응답은 바로 돌려주고, 배치 처리는 백그라운드에서 진행하며 상태를 갱신한다.
  runBatch().catch((err) => {
    console.error("배치 처리 중 오류:", err);
  });
  return NextResponse.json({ ok: true });
}
