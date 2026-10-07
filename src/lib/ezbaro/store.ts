// 이지바로 연구원정보 수집 기능의 진행 상태.
// Next.js 개발 서버는 이 모듈을 다시 불러올 수 있어서, 상태를 globalThis에 보관해
// 요청이 바뀌어도 유지되게 한다(RCMS 기능의 lib/store.ts와 같은 방식).

export type EzbaroStatus = "idle" | "login-open" | "running" | "done" | "error";

export interface EzbaroRow {
  taskNo: string;
  year: string;
}

export interface EzbaroResult {
  taskNo: string;
  year: string;
  orgType: string;
  orgName: string;
  gridResearcher: string;
  name: string;
  phone: string;
  email: string;
  bizNo: string;
  note: string;
}

export interface EzbaroState {
  rows: EzbaroRow[];
  status: EzbaroStatus;
  log: string[];
  error: string | null;
  stopRequested: boolean;
  results: EzbaroResult[];
}

declare global {
  var __ezbaroState: EzbaroState | undefined;
}

const MAX_LOGS = 500;

function initialState(): EzbaroState {
  return { rows: [], status: "idle", log: [], error: null, stopRequested: false, results: [] };
}

export function getEzbaroState(): EzbaroState {
  if (!globalThis.__ezbaroState) {
    globalThis.__ezbaroState = initialState();
  }
  return globalThis.__ezbaroState;
}

export function resetEzbaroState(): EzbaroState {
  globalThis.__ezbaroState = initialState();
  return globalThis.__ezbaroState;
}

export function pushEzbaroLog(line: string): void {
  const state = getEzbaroState();
  const time = new Date().toLocaleTimeString("ko-KR");
  state.log.push(`[${time}] ${line}`);
  if (state.log.length > MAX_LOGS) state.log.shift();
}
