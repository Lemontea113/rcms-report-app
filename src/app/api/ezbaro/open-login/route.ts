export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { openLoginBrowser } from "@/lib/ezbaro/automation";
import { getEzbaroState, pushEzbaroLog } from "@/lib/ezbaro/store";

export async function POST() {
  const state = getEzbaroState();
  try {
    await openLoginBrowser();
    state.status = "login-open";
    pushEzbaroLog("브라우저를 열었습니다. 새로 뜬 창에서 직접 로그인해주세요.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.status = "error";
    state.error = message;
    pushEzbaroLog(`로그인 창을 여는 데 실패했습니다: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
