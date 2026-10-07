import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

interface RcmsSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

declare global {
  var __rcmsSession: RcmsSession | undefined;
}

export async function openLoginBrowser(): Promise<void> {
  await closeSession();
  // 설치형 프로그램에 크롬을 통째로 넣으면 너무 커지므로, 모든 Windows PC에 기본으로
  // 깔려 있는 Edge를 불러다 쓴다(사용자가 브라우저를 따로 설치할 필요가 없다).
  const browser = await chromium.launch({
    channel: "msedge",
    headless: false,
    args: ["--start-maximized"],
  });
  // 창을 최대화된 크기로 띄워서, 조회 결과 표가 스크롤 없이 최대한 많이 보이게 한다.
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("https://rcms.go.kr/index.do");
  globalThis.__rcmsSession = { browser, context, page };
}

export async function closeSession(): Promise<void> {
  const session = globalThis.__rcmsSession;
  if (session) {
    await session.browser.close().catch(() => {});
    globalThis.__rcmsSession = undefined;
  }
}

export function getSession(): RcmsSession {
  const session = globalThis.__rcmsSession;
  if (!session) {
    throw new Error("RCMS 브라우저 세션이 없습니다. 먼저 '수행'을 눌러주세요.");
  }
  return session;
}
