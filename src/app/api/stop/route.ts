export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requestStop } from "@/lib/store";

export async function POST() {
  // 지금 처리 중인 과제번호까지는 끝내고, 다음 과제번호로 넘어가기 전에 멈춘다.
  requestStop();
  return NextResponse.json({ ok: true });
}
