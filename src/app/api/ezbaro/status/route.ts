export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getEzbaroState } from "@/lib/ezbaro/store";

export async function GET() {
  const state = getEzbaroState();
  return NextResponse.json({
    status: state.status,
    log: state.log,
    rowCount: state.rows.length,
    error: state.error,
    results: state.results,
  });
}
