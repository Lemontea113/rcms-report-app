export const runtime = "nodejs";

import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

// 실패 시점 캡처 이미지는 항상 os.tmpdir()/rcms-report-app/ 아래에만 저장되므로,
// 그 밖의 경로는 절대 읽어주지 않는다.
const BASE_DIR = path.resolve(path.join(os.tmpdir(), "rcms-report-app"));

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path가 필요합니다." }, { status: 400 });
  }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(BASE_DIR)) {
    return NextResponse.json({ error: "허용되지 않은 경로입니다." }, { status: 403 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "image/png" },
    });
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}
