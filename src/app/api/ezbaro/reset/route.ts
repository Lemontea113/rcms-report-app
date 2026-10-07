export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { closeBrowser } from "@/lib/ezbaro/automation";
import { resetEzbaroState } from "@/lib/ezbaro/store";

export async function POST() {
  await closeBrowser();
  resetEzbaroState();
  return NextResponse.json({ ok: true });
}
