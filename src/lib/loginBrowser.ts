import { chromium, type Browser } from "playwright";

// RCMS·이지바로 로그인 창을 사용자 PC에 설치된 Google Chrome으로 띄운다.
// 설치형 프로그램에 브라우저를 통째로 넣으면 너무 커지므로, 이미 깔려 있는 Chrome을 불러다 쓴다.
export async function launchLoginBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: false,
      args: ["--start-maximized"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Chrome이 없을 때 Playwright가 내는 영문 오류 대신, 사용자가 할 일을 알려준다.
    if (/chrome.*(not found|is not found|doesn't exist|executable)/i.test(message)) {
      throw new Error(
        "이 컴퓨터에서 Google Chrome을 찾지 못했습니다. https://www.google.com/chrome 에서 Chrome을 설치한 뒤 다시 시도해주세요."
      );
    }
    throw err;
  }
}
