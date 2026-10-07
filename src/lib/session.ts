import type { Browser, BrowserContext, Page } from "playwright";
import { launchLoginBrowser } from "./loginBrowser";

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
  const browser = await launchLoginBrowser();
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
