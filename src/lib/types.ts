export type TaskState = "대기중" | "처리중" | "완료" | "실패";

export interface ReportData {
  projectNo: string;
  org: string;
  pi: string;
  periodTotal: string; // "2023.07.01 ~ 2026.06.30"
  periodStage: string;
  periodYear: string;
  partners: string; // comma-separated, may be ""
}

export interface TaskItem {
  projectNo: string;
  state: TaskState;
  data?: ReportData;
  error?: string;
}

export type Phase = "idle" | "awaiting_login" | "processing" | "done";

export interface LogEntry {
  time: string; // "HH:MM:SS"
  message: string;
  screenshotPath?: string; // 실패 시점 화면 캡처 파일 경로 (있을 때만)
}

export interface JobState {
  phase: Phase;
  tasks: TaskItem[];
  logs: LogEntry[];
}
