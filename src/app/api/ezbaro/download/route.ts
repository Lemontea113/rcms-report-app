export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { buildEzbaroWorkbookBuffer, ezbaroOutputFileName } from "@/lib/ezbaro/excel";
import { getEzbaroState } from "@/lib/ezbaro/store";

export async function GET() {
  const { results } = getEzbaroState();
  if (results.length === 0) {
    return new NextResponse("아직 결과가 없습니다.", { status: 404 });
  }

  const buffer = await buildEzbaroWorkbookBuffer(results);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(ezbaroOutputFileName())}`,
    },
  });
}
