export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getState } from "@/lib/store";

export async function GET() {
  return NextResponse.json(getState());
}
