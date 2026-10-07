export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { closeBrowser as closeEzbaroBrowser } from "@/lib/ezbaro/automation";
import { closeSession as closeRcmsBrowser } from "@/lib/session";

// 프로그램을 끌 때(electron/main.js) 호출된다 — 두 기능에서 열어 둔 로그인 창을 모두 닫는다.
export async function POST() {
  await Promise.all([closeRcmsBrowser(), closeEzbaroBrowser()]);
  return NextResponse.json({ ok: true });
}
