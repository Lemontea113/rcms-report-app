"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EzbaroResult, EzbaroStatus } from "@/lib/ezbaro/store";

interface StatusResponse {
  status: EzbaroStatus;
  log: string[];
  rowCount: number;
  error: string | null;
  results: EzbaroResult[];
}

const EMPTY: StatusResponse = { status: "idle", log: [], rowCount: 0, error: null, results: [] };

function groupByTaskNo(results: EzbaroResult[]) {
  const groups = new Map<string, EzbaroResult[]>();
  for (const r of results) {
    const list = groups.get(r.taskNo) ?? [];
    list.push(r);
    groups.set(r.taskNo, list);
  }
  return Array.from(groups.entries());
}

export default function EzbaroPage() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<StatusResponse>(EMPTY);
  const [uploadMsg, setUploadMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // 조회는 서버에서 진행되므로, 화면은 1.5초마다 진행 상황을 받아와 보여주기만 한다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/ezbaro/status");
        if (!cancelled) setData(await res.json());
      } catch {
        // 잠깐 응답이 없을 때는 다음 번에 다시 시도한다.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data.log.length]);

  async function post(url: string, body?: BodyInit) {
    setErrorMsg("");
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", body });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "알 수 없는 오류가 발생했습니다.");
      return json;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!file) {
      setErrorMsg("엑셀 파일을 먼저 선택해주세요.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const json = await post("/api/ezbaro/upload", formData);
    setUploadMsg(json ? `${json.count}건 업로드 완료` : "");
  }

  async function handleReset() {
    await post("/api/ezbaro/reset");
    setFile(null);
    setUploadMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const running = data.status === "running";
  const groups = groupByTaskNo(data.results);

  return (
    <div className="min-h-screen bg-violet-50">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 inline-block text-sm text-violet-700/70 hover:text-violet-900">
              ← 처음으로
            </Link>
            <h1 className="text-2xl font-bold text-violet-900">이지바로 연구원정보 수집</h1>
            <p className="mt-1 text-sm text-violet-700/70">
              이지바로 상시점검 관리 화면에서 과제번호별 연구원 정보를 자동으로 모읍니다.
            </p>
          </div>
          {data.status !== "idle" && (
            <button
              onClick={handleReset}
              disabled={busy || running}
              className="shrink-0 rounded-full border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40"
            >
              다시 시작
            </button>
          )}
        </header>

        {errorMsg && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{errorMsg}</p>}

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-100">
          <h2 className="font-semibold text-violet-800">1단계. 엑셀 업로드</h2>
          <p className="mt-1 text-sm text-gray-500">1열: 과제번호, 2열: 년도 (1행은 제목행으로 보고 건너뜁니다)</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={running}
              className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-full file:border-0 file:bg-violet-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-violet-700 hover:file:bg-violet-200"
            />
            <button
              onClick={handleUpload}
              disabled={busy || running}
              className="shrink-0 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
            >
              업로드
            </button>
          </div>
          {uploadMsg && <p className="mt-2 text-sm text-violet-700">{uploadMsg}</p>}
        </section>

        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-100">
          <h2 className="font-semibold text-violet-800">2단계. 로그인</h2>
          <p className="mt-1 text-sm text-gray-500">
            버튼을 누르면 Chrome 창이 열립니다. 그 창에서 GAIA에 직접 로그인만 해주세요.
          </p>
          <button
            onClick={() => post("/api/ezbaro/open-login")}
            disabled={busy || running}
            className="mt-3 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
          >
            로그인 창 열기
          </button>
        </section>

        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-100">
          <h2 className="font-semibold text-violet-800">3단계. 자동 실행</h2>
          <p className="mt-1 text-sm text-gray-500">
            로그인을 마치신 뒤에 눌러주세요. &quot;정산 &gt; 상시점검 &gt; 상시점검 관리&quot; 화면 이동과 &quot;상시점검
            보고서 생성대상 여부&quot; 체크 해제(처음 한 번만)까지 자동으로 진행됩니다.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => post("/api/ezbaro/run")}
              disabled={busy || running || data.rowCount === 0}
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
            >
              시작
            </button>
            <button
              onClick={() => post("/api/ezbaro/stop")}
              disabled={!running}
              className="rounded-full border border-red-300 px-5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              중단
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-100">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-violet-800">미리보기 (과제번호별)</h2>
            <a
              href="/api/ezbaro/download"
              aria-disabled={data.results.length === 0}
              className={`rounded-full px-5 py-2 text-sm font-semibold text-white ${
                data.results.length === 0 ? "pointer-events-none bg-violet-300" : "bg-violet-600 hover:bg-violet-700"
              }`}
            >
              {data.status === "done" ? "결과 엑셀 다운로드 (완료)" : "결과 엑셀 다운로드"}
            </a>
          </div>
          <p className="mb-3 text-sm text-gray-500">
            지금까지 자동으로 읽어낸 값입니다. 실제로 맞게 읽었는지 확인해보세요. 화면 캡처는 다운로드 폴더의
            &quot;날짜_이지바로_책임자정보_캡쳐&quot; 폴더에 저장됩니다.
          </p>
          {groups.length === 0 ? (
            <p className="text-sm text-gray-400">아직 처리된 과제가 없어요.</p>
          ) : (
            groups.map(([taskNo, rows]) => (
              <div key={taskNo} className="mb-4">
                <h3 className="mb-1 font-mono text-sm font-semibold text-violet-700">{taskNo}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-violet-50 text-violet-700">
                        {["기관구분", "기관명", "사업자등록번호", "연구책임자", "성명(팝업)", "휴대폰", "이메일", "비고"].map(
                          (h) => (
                            <th key={h} className="border border-violet-100 px-2 py-1">
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="text-gray-800">
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="border border-violet-100 px-2 py-1">{r.orgType}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.orgName}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.bizNo}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.gridResearcher}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.name}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.phone}</td>
                          <td className="border border-violet-100 px-2 py-1">{r.email}</td>
                          <td className="border border-violet-100 px-2 py-1 text-red-600">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-100">
          <h2 className="mb-3 font-semibold text-violet-800">진행 상황</h2>
          <div
            ref={logRef}
            className="h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#2e2640] p-3 font-mono text-xs text-[#d9c9f5]"
          >
            {data.log.join("\n")}
          </div>
        </section>
      </main>
    </div>
  );
}
