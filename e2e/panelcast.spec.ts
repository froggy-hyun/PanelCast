import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  // optional
}

const DEMO_EPISODE_ID = 'ep_solo_max_newbie_02';
const STUDIO_TOKEN =
  process.env.PUBLISHER_STUDIO_TOKEN ||
  process.env.STUDIO_ADMIN_TOKEN ||
  process.env.PANELCAST_STUDIO_SECRET ||
  'panelcast-publisher-secret-2026';

test.describe('PanelCast End-to-End & Accessibility Verification (T10-T15)', () => {
  test('T14-A: Library Home Page renders published episode and passes axe-core WCAG 2.1 AA', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('웹툰 서재');
    await expect(page.getByText('나 혼자 만렙 뉴비')).toBeVisible({ timeout: 15000 });

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('T10, T11, T12, T14-B, T15: Accessible Reader cut navigation, rapid skip cleanup, KO/EN switch, hotkey guard, and WCAG audit', async ({
    page,
  }) => {
    await page.goto(`/read/${DEMO_EPISODE_ID}`);
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
    const koSummary = await page.getByTestId('panel-visual-summary').textContent();
    await page.getByTestId('locale-toggle-btn').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('active-panel-indicator')).toContainText('Cut 6 of', {
      timeout: 15000,
    });
    const enSummary = await page.getByTestId('panel-visual-summary').textContent();
    expect(enSummary).toBeTruthy();
    expect(enSummary).not.toEqual(koSummary);

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

  test('T13 & T14-C: Studio Workbench enforces authentication and passes axe-core WCAG 2.1 AA', async ({
    page,
    request,
  }) => {
    // Unauthenticated API request must be rejected
    const unauthRes = await request.get(`/api/studio/episodes/${DEMO_EPISODE_ID}`);
    expect([401, 403]).toContain(unauthRes.status());

    // Visit Studio UI and unlock with publisher token
    await page.goto(`/studio/${DEMO_EPISODE_ID}`);
    await expect(page.locator('h1')).toContainText('출판사 스튜디오 인증 필요');

    await page.locator('#studio-token').fill(STUDIO_TOKEN);
    await page.getByRole('button', { name: '인증하기' }).click();

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
