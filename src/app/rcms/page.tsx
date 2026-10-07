"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JobState, TaskState } from "@/lib/types";

const STATE_BADGE: Record<TaskState, string> = {
  대기중: "bg-gray-100 text-gray-600",
  처리중: "bg-pink-100 text-pink-700",
  완료: "bg-emerald-100 text-emerald-700",
  실패: "bg-red-100 text-red-700",
};

export default function RcmsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobState>({ phase: "idle", tasks: [], logs: [] });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [stopRequested, setStopRequested] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [job.logs]);

  useEffect(() => {
    // 조회는 서버에서 계속 진행되므로, 첫 화면에 다녀오면 그동안의 진행 상황을 다시 불러온다.
    fetch("/api/status")
      .then((res) => res.json())
      .then((data: JobState) => {
        if (data.phase === "idle") return;
        setJob(data);
        if (data.phase !== "done") startPolling();
      })
      .catch(() => {});
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/status");
      const data: JobState = await res.json();
      setJob(data);
      if (data.phase === "done" && pollRef.current) {
        clearInterval(pollRef.current);
      }
    }, 1500);
  }

  async function handleStart() {
    setErrorMsg("");
    if (!file) {
      setErrorMsg("엑셀 파일을 먼저 선택해주세요.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "엑셀 파일을 읽지 못했습니다.");

      const startRes = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectNos: uploadData.projectNos }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? "RCMS 로그인 창을 여는 데 실패했습니다.");

      setJob({
        phase: "awaiting_login",
        tasks: uploadData.projectNos.map((projectNo: string) => ({ projectNo, state: "대기중" })),
        logs: [],
      });
      startPolling();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginDone() {
    setBusy(true);
    setErrorMsg("");
    try {
      await fetch("/api/confirm-login", { method: "POST" });
      startPolling();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setStopRequested(true);
    await fetch("/api/stop", { method: "POST" });
  }

  async function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setBusy(true);
    setErrorMsg("");
    try {
      await fetch("/api/reset", { method: "POST" });
    } finally {
      setBusy(false);
      setStopRequested(false);
      setFile(null);
      setJob({ phase: "idle", tasks: [], logs: [] });
    }
  }

  const doneCount = job.tasks.filter((t) => t.state === "완료" || t.state === "실패").length;

  return (
    <div className="min-h-screen bg-pink-50">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 inline-block text-sm text-pink-700/70 hover:text-pink-900">
              ← 처음으로
            </Link>
            <h1 className="text-2xl font-bold text-pink-900">RCMS 사용실적보고서 조회</h1>
            <p className="mt-1 text-sm text-pink-700/70">
              과제번호 목록을 업로드하면 RCMS에서 사용실적보고서 정보를 자동으로 모아드립니다.
            </p>
          </div>
          {job.phase !== "idle" && (
            <button
              onClick={handleReset}
              disabled={busy}
              className="shrink-0 rounded-full border border-pink-300 px-4 py-2 text-sm font-medium text-pink-700 hover:bg-pink-100 disabled:opacity-40"
            >
              다시 시작
            </button>
          )}
        </header>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-pink-100">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                과제번호 엑셀 업로드 ( &quot;과제번호&quot; 열 필요 )
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={job.phase !== "idle"}
                className="mt-2 block w-full text-sm text-gray-600 file:mr-4 file:rounded-full file:border-0 file:bg-pink-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-pink-700 hover:file:bg-pink-200"
              />
            </div>
            <button
              onClick={handleStart}
              disabled={busy || job.phase !== "idle"}
              className="shrink-0 rounded-full bg-pink-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              수행
            </button>
          </div>

          {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}

          {job.phase === "awaiting_login" && (
            <div className="mt-5 rounded-xl bg-pink-50 p-4 text-sm text-pink-800">
              새로 열린 브라우저 창에서 RCMS에 로그인해주세요. 로그인을 마쳤으면 아래 버튼을 눌러주세요.
              <div className="mt-3">
                <button
                  onClick={handleLoginDone}
                  disabled={busy}
                  className="rounded-full bg-pink-600 px-5 py-2 text-sm font-semibold text-white hover:bg-pink-700 disabled:opacity-40"
                >
                  로그인 완료
                </button>
              </div>
            </div>
          )}
        </section>

        {job.tasks.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-pink-100">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">처리 현황</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  {doneCount} / {job.tasks.length}
                </span>
                {job.phase === "processing" && (
                  <button
                    onClick={handleStop}
                    disabled={stopRequested}
                    className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    중단
                  </button>
                )}
              </div>
            </div>
            {stopRequested && job.phase === "processing" && (
              <p className="mb-3 text-sm text-pink-700">
                중단 요청됨 — 지금 처리 중인 과제번호까지 끝내고 멈춥니다.
              </p>
            )}
            <ul className="divide-y divide-gray-100">
              {job.tasks.map((task) => (
                <li key={task.projectNo} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-gray-700">{task.projectNo}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATE_BADGE[task.state]}`}>
                    {task.state}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {job.logs.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-pink-100">
            <h2 className="mb-3 font-semibold text-gray-800">실행 로그</h2>
            <div className="max-h-[32rem] overflow-y-auto rounded-xl bg-gray-50 p-3 font-mono text-xs text-gray-700">
              {job.logs.map((log, i) => (
                <div key={i} className="py-0.5">
                  <span className="text-gray-400">[{log.time}]</span> {log.message}
                  {log.screenshotPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/screenshot?path=${encodeURIComponent(log.screenshotPath)}`}
                      alt="실패 시점 화면"
                      className="mt-1 mb-2 max-w-full rounded border border-gray-300"
                    />
                  )}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>
        )}

        {job.phase === "done" && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-pink-100">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">결과 미리보기</h2>
              <a
                href="/api/download"
                className="rounded-full bg-pink-600 px-5 py-2 text-sm font-semibold text-white hover:bg-pink-700"
              >
                다운로드
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-pink-50 text-gray-600">
                    <th className="px-3 py-2">과제번호</th>
                    <th className="px-3 py-2">기관명</th>
                    <th className="px-3 py-2">연구책임자</th>
                    <th className="px-3 py-2">공동기관</th>
                    <th className="px-3 py-2">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  {job.tasks.map((task) => (
                    <tr key={task.projectNo}>
                      <td className="px-3 py-2 font-mono">{task.projectNo}</td>
                      <td className="px-3 py-2">{task.data?.org ?? "-"}</td>
                      <td className="px-3 py-2">{task.data?.pi ?? "-"}</td>
                      <td className="px-3 py-2">{task.data?.partners || "-"}</td>
                      <td className="px-3 py-2 text-red-600">{task.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
