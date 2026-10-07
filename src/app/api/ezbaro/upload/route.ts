export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readEzbaroRows } from "@/lib/ezbaro/excel";
import { getEzbaroState, pushEzbaroLog } from "@/lib/ezbaro/store";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
  }

  try {
    const rows = await readEzbaroRows(Buffer.from(await file.arrayBuffer()));
    getEzbaroState().rows = rows;
    pushEzbaroLog(`엑셀 업로드 완료: ${rows.length}건`);
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
