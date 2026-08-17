import { test, expect } from '@playwright/test';

// İlk ziyaret rehberi (tutorial) ekranı kaplar → testten önce "görüldü" işaretle.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('game2048.tutorialSeen', '1');
    localStorage.setItem('game2048.lang', 'tr'); // deterministik dil (tarayıcı yerelinden bağımsız)
  });
});

test('başlangıç ekranı yüklenir — başlık + mod kartları', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-start-screen')).toBeVisible();
  // Klasik · Zen · Zaman Yarışı · Seviye · Bulmaca
  await expect(page.locator('.mode-card')).toHaveCount(5);
});

test('Klasik oyun başlar ve klavyeyle oynanır', async ({ page }) => {
  await page.goto('/');
  await page.locator('.mode-card').first().click(); // Klasik
  await expect(page.locator('app-game-view')).toBeVisible();
  await expect(page.locator('.cell-bg')).toHaveCount(16); // 4×4 varsayılan
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  // Oyun sürüyor: tahtada en az bir taş var.
  await expect(page.locator('app-tile').first()).toBeVisible();
});

test('tahta boyutu 3×3 seçilince 9 hücreyle oynanır', async ({ page }) => {
  await page.goto('/');
  await page.locator('.size-choice button').first().click(); // 3×3 (ilk seçenek)
  await page.locator('.mode-card').first().click(); // Klasik
  await expect(page.locator('.cell-bg')).toHaveCount(9);
});

test('dil TR → EN anında değişir (Ayarlar)', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[aria-label="Ayarlar"]').click();
  await expect(page.locator('.settings-title')).toContainText('Ayarlar');
  await page.getByRole('button', { name: /English/ }).click();
  await expect(page.locator('.settings-title')).toContainText('Settings');
});
