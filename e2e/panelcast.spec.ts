import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  // optional
}

const DEMO_EPISODE_ID = 'ep_solo_max_newbie_02';

test.describe('PanelCast End-to-End & Accessibility Verification (T10-T15)', () => {
  test('T14-A: Intro logo animation, 2-Tab Navigation (Library & Open Desk), and axe-core WCAG 2.1 AA', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. 최초 접속 시 중앙 인트로 로고 애니메이션(pc-to-panelcast-anim.gif) 1회 재생 확인
    const splash = page.getByTestId('intro-splash');
    await expect(splash).toBeVisible();
    const splashGif = page.getByTestId('intro-splash-gif');
    await expect(splashGif).toHaveAttribute('src', '/pc-to-panelcast-anim.gif');

    // 건너뛰기 버튼으로 인트로 종료 후 본 화면 검증
    await page.getByTestId('intro-splash-skip').click();
    await expect(splash).toBeHidden();

    // 2. 업로드된 브랜드 로고(/logo.png) 및 2개 메뉴 탭 확인
    await expect(page.locator('header img.brand-logo')).toHaveAttribute('src', '/logo.png');
    const tabLibrary = page.getByTestId('tab-library');
    const tabDesk = page.getByTestId('tab-desk');
    await expect(tabLibrary).toBeVisible();
    await expect(tabDesk).toBeVisible();
    await expect(tabLibrary).toHaveAttribute('aria-selected', 'true');

    // 3. 홈 탭(공개 연재 에피소드) 렌더링 및 WCAG 2.1 AA 검증
    await expect(page.getByText('나 혼자 만렙 뉴비')).toBeVisible({ timeout: 15000 });

    const axeLibrary = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const libraryViolations = axeLibrary.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(libraryViolations).toEqual([]);

    // 4. 두 번째 탭(작가 · 출판사 원고 등록 데스크) 전환 시 별도 로그인 없이 즉시 접근 가능 확인
    await tabDesk.click();
    await expect(tabDesk).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('신규 에피소드 원고 업로드')).toBeVisible();

    const axeDesk = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const deskViolations = axeDesk.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(deskViolations).toEqual([]);
  });

  test('T10, T11, T12, T14-B, T15: Accessible Reader cut navigation, high-contrast webtoon image switch, KO/EN switch, hotkey guard, and WCAG audit', async ({
    page,
    request,
  }) => {
    await page.goto(`/read/${DEMO_EPISODE_ID}`);
    const skipBtn = page.getByTestId('intro-splash-skip');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await expect(page.getByTestId('active-panel-indicator')).toContainText('제 1 컷', {
      timeout: 20000,
    });

    // T14: Reader WCAG 2.1 AA verification
    const axeReader = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const readerViolations = axeReader.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(readerViolations).toEqual([]);

    // 고대비 모드 전환 시 UI뿐 아니라 웹툰 원고 이미지도 고대비(?contrast=high) 에셋으로 전환되는지 검증
    const panelImg = page.getByTestId('active-panel-image');
    await expect(panelImg).toHaveAttribute('data-contrast-mode', 'normal');
    await page.getByTestId('high-contrast-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await expect(panelImg).toHaveAttribute('data-contrast-mode', 'high');
    const hcSrc = await panelImg.getAttribute('src');
    expect(hcSrc).toContain('contrast=high');

    const hcRes = await request.get(hcSrc!);
    expect(hcRes.status()).toBe(200);
    expect(hcRes.headers()['content-type']).toContain('image/');

    // 다시 일반 대비로 복귀
    await page.getByTestId('high-contrast-toggle-btn').click();
    await expect(panelImg).toHaveAttribute('data-contrast-mode', 'normal');

    const root = page.getByTestId('reader-root');
    const initialSessionId = Number(await root.getAttribute('data-playback-session-id'));
    expect(initialSessionId).toBeGreaterThanOrEqual(1);

    // T11: Rapidly skip 5 cuts via ArrowRight and verify session cleanup + single active audio bound
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }

    await expect(page.getByTestId('active-panel-indicator')).toContainText('제 6 컷');
    const afterSkipSessionId = Number(await root.getAttribute('data-playback-session-id'));
    expect(afterSkipSessionId).toBeGreaterThan(initialSessionId);

    const activeAudioCount = Number(await root.getAttribute('data-active-audio-count'));
    expect(activeAudioCount).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('live-announcer')).toContainText('6번째 컷으로 이동');

    // T12: Switch locale KO -> EN and verify lang attribute + English narration without losing cut position
    const koSummary = (await page.getByTestId('panel-visual-summary').textContent())?.trim() || '';
    await page.getByTestId('locale-toggle-btn').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('active-panel-indicator')).toContainText('Cut 6 of', {
      timeout: 15000,
    });
    await expect(page.getByTestId('panel-visual-summary')).not.toHaveText(koSummary, {
      timeout: 10000,
    });

    // Switch back to KO via 'L' hotkey
    await page.keyboard.press('l');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.getByTestId('active-panel-indicator')).toContainText('제 6 컷', {
      timeout: 15000,
    });

    // T15: Typing hotkeys inside feedback textarea must not trigger navigation or locale switch
    const issueInput = page.getByTestId('reader-issue-input');
    await issueInput.focus();
    await issueInput.fill('Space j k r l 단축키 입력 간섭 테스트');
    await expect(page.getByTestId('active-panel-indicator')).toContainText('제 6 컷');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  });

  test('T13 & T14-C: Open MVP Studio access, password 7057 delete protection, and axe-core WCAG 2.1 AA', async ({
    page,
    request,
  }) => {
    // 1. 잘못된 비밀번호로 원고 삭제 요청 시 403 거부 확인 (올바른 비밀번호는 7057)
    const wrongPassDelete = await request.delete(`/api/studio/episodes/${DEMO_EPISODE_ID}`, {
      data: { password: '0000' },
    });
    expect(wrongPassDelete.status()).toBe(403);

    // 2. 별도 로그인/토큰 없이 누구나 커스텀 스튜디오 즉시 접근 가능 확인
    await page.goto(`/studio/${DEMO_EPISODE_ID}`);
    const skipBtn = page.getByTestId('intro-splash-skip');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await expect(page.locator('h1')).toContainText('접근성 커스텀 스튜디오', {
      timeout: 20000,
    });

    const axeStudio = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const studioViolations = axeStudio.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(studioViolations).toEqual([]);
  });
});
