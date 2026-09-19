import fs from "fs/promises";
import os from "os";
import path from "path";
import { addLog, getState, isStopRequested, setDownloadDir } from "./store";
import { getSession } from "./session";
import { AutomationError, downloadReportForProject, enterRndInstitutionPortal } from "./rcmsAutomation";
import { parseReportHtmlFile } from "./reportHtmlParser";
import type { TaskItem } from "./types";

// 중단됐을 때, 아직 시작 못 한 "처리중" 상태의 과제번호들을 "대기중"으로 되돌려서
// (엑셀에 "미처리(중단됨)"으로 남도록) 상태가 어중간하게 남지 않게 한다.
function revertUnstartedToWaiting(tasks: TaskItem[], fromIndex: number) {
  for (let i = fromIndex; i < tasks.length; i++) {
    if (tasks[i].state === "처리중") {
      tasks[i].state = "대기중";
    }
  }
}

export async function runBatch(): Promise<void> {
  const state = getState();
  state.phase = "processing";
  addLog(`총 ${state.tasks.length}건 처리를 시작합니다.`);

  // 로그인 직후 화면에서 R&D전문기관 포털로 한 번만 들어간다.
  const { page } = getSession();
  try {
    await enterRndInstitutionPortal(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`R&D전문기관 화면 진입 실패: ${message}`);
    for (const task of state.tasks) {
      task.state = "실패";
      task.error = `R&D전문기관 화면 진입 실패: ${message}`;
    }
    state.phase = "done";
    return;
  }

  const downloadDir = path.join(os.tmpdir(), "rcms-report-app", String(Date.now()));
  await fs.mkdir(downloadDir, { recursive: true });
  setDownloadDir(downloadDir);
  addLog(`다운로드한 HTML을 저장할 폴더: ${downloadDir}`);

  for (let i = 0; i < state.tasks.length; i++) {
    const task = state.tasks[i];
    if (isStopRequested()) {
      addLog("사용자 요청으로 중단합니다. 남은 과제번호는 처리하지 않습니다.");
      revertUnstartedToWaiting(state.tasks, i);
      break;
    }
    task.state = "처리중";
    try {
      const filePath = await downloadReportForProject(task.projectNo, downloadDir, i === 0);
      const data = await parseReportHtmlFile(filePath, task.projectNo);
      // 1페이지가 아닌 내용이 저장됐거나 파일이 예상과 다르면 값이 하나도 안 잡힌다 —
      // 빈 값인 채로 "완료" 처리하면 조용히 잘못된 결과가 쌓이므로 실패로 알린다.
      if (!data.org && !data.pi) {
        throw new Error(
          `받은 파일에서 기관명·연구책임자를 찾지 못했습니다(1페이지가 아닌 내용이 저장됐을 수 있음): ${filePath}`
        );
      }
      task.data = data;
      task.state = "완료";
      addLog(`과제번호 "${task.projectNo}" 처리 완료`);
    } catch (err) {
      task.state = "실패";
      task.error = err instanceof Error ? err.message : String(err);
      const screenshotPath = err instanceof AutomationError ? err.screenshotPath : undefined;
      addLog(`과제번호 "${task.projectNo}" 처리 실패: ${task.error}`, screenshotPath);
    }
  }

  addLog("모든 처리가 끝났습니다.");
  state.phase = "done";
}
