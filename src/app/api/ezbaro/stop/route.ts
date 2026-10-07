export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getEzbaroState, pushEzbaroLog } from "@/lib/ezbaro/store";

export async function POST() {
  getEzbaroState().stopRequested = true;
  pushEzbaroLog("중단 요청을 받았습니다. 지금 처리 중인 과제까지만 마치고 멈춥니다...");
  return NextResponse.json({ ok: true });
}
