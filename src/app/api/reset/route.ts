export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { clearState } from "@/lib/store";
import { closeSession } from "@/lib/session";

export async function POST() {
  await closeSession();
  clearState();
  return NextResponse.json({ ok: true });
}
