import type { JobState } from "./types";

// Next.js dev server can reload this module; stash the singleton on
// globalThis so state survives across route handler invocations.
declare global {
  var __rcmsJobState: JobState | undefined;
  var __rcmsStopRequested: boolean | undefined;
  var __rcmsDownloadDir: string | undefined;
}

const MAX_LOGS = 500;

function initialState(): JobState {
  return { phase: "idle", tasks: [], logs: [] };
}

export function addLog(message: string, screenshotPath?: string): void {
  const state = getState();
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  state.logs.push({ time, message, screenshotPath });
  if (state.logs.length > MAX_LOGS) {
    state.logs.splice(0, state.logs.length - MAX_LOGS);
  }
}

export function getState(): JobState {
  if (!globalThis.__rcmsJobState) {
    globalThis.__rcmsJobState = initialState();
  }
  return globalThis.__rcmsJobState;
}

export function resetState(projectNos: string[]): JobState {
  globalThis.__rcmsStopRequested = false;
  globalThis.__rcmsJobState = {
    phase: "awaiting_login",
    tasks: projectNos.map((projectNo) => ({ projectNo, state: "대기중" as const })),
    logs: [],
  };
  return globalThis.__rcmsJobState;
}

export function clearState(): JobState {
  globalThis.__rcmsStopRequested = false;
  globalThis.__rcmsJobState = initialState();
  return globalThis.__rcmsJobState;
}

export function requestStop(): void {
  globalThis.__rcmsStopRequested = true;
}

export function isStopRequested(): boolean {
  return globalThis.__rcmsStopRequested === true;
}

export function setDownloadDir(dir: string): void {
  globalThis.__rcmsDownloadDir = dir;
}

export function getDownloadDir(): string | undefined {
  return globalThis.__rcmsDownloadDir;
}
