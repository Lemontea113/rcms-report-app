export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readTaskNumbers } from "@/lib/excel";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const projectNos = await readTaskNumbers(buffer);
    if (projectNos.length === 0) {
      return NextResponse.json({ error: "'과제번호' 열에서 값을 찾지 못했습니다." }, { status: 400 });
    }
    return NextResponse.json({ projectNos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
