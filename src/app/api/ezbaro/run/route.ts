export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { confirmLoginAndNavigate, isBrowserOpen, runAutomation } from "@/lib/ezbaro/automation";
import { ezbaroOutputFileName } from "@/lib/ezbaro/excel";
import { getEzbaroState, pushEzbaroLog } from "@/lib/ezbaro/store";

async function runInBackground() {
  const state = getEzbaroState();
  try {
    pushEzbaroLog("정산 > 상시점검 > 상시점검 관리 화면으로 자동 이동 중...");
    await confirmLoginAndNavigate();
    pushEzbaroLog("이동 완료.");
  } catch (err) {
    pushEzbaroLog(
      `메뉴 이동 중 오류: ${err} (화면에서 상시점검 관리 화면이 맞는지 직접 확인 후 다시 "시작"을 눌러주세요)`
    );
    state.status = "login-open";
    return;
  }

  try {
    // 과제 하나를 처리할 때마다 결과를 갱신해서, 중간에 실패해도 그때까지 모은 결과를
    // 미리보기와 다운로드로 받을 수 있게 한다.
    const results = await runAutomation(
      state.rows,
      pushEzbaroLog,
      (partial) => {
        state.results = [...partial];
      },
      () => state.stopRequested
    );
    state.results = results;
    state.status = "done";
    pushEzbaroLog(
      state.stopRequested
        ? `중단됨: 그때까지 처리된 ${results.length}건 저장 (${ezbaroOutputFileName()})`
        : `완료: 총 ${results.length}건 저장 (${ezbaroOutputFileName()})`
    );
  } catch (err) {
    state.status = "error";
    state.error = String(err);
    pushEzbaroLog(`오류 발생: ${err} (여기까지 처리된 내용은 결과 엑셀로 다운로드 가능합니다)`);
  }
}

export async function POST() {
  const state = getEzbaroState();
  if (!state.rows.length) {
    return NextResponse.json({ ok: false, error: "먼저 엑셀 파일을 업로드해주세요." }, { status: 400 });
  }
  if (!isBrowserOpen()) {
    return NextResponse.json({ ok: false, error: "먼저 로그인 브라우저를 여는 단계를 진행해주세요." }, { status: 400 });
  }

  state.status = "running";
  state.stopRequested = false;
  state.results = [];
  // 응답은 바로 돌려주고, 조회는 백그라운드에서 진행하며 상태를 갱신한다.
  runInBackground().catch((err) => console.error("이지바로 처리 중 오류:", err));
  return NextResponse.json({ ok: true });
}
