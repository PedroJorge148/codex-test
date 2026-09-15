import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
async function login(page: Page) {
  const env = parseEnv(await readFile('.local/dev.env', 'utf8'));
  await page.goto('/'); await page.getByRole('link', { name: 'Entrar com minha conta' }).click();
  await page.locator('#username').fill('admin@example.test'); await page.locator('#password').fill(env.INITIAL_ADMIN_PASSWORD!); await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'Candidaturas', exact: false })).toBeVisible();
}
test('autenticação real com o administrador configurado', async ({ page }) => {
  await login(page);
  const response = await page.request.get('/api/session');
  expect(response.ok()).toBe(true);
  expect((await response.json()).organizations.length).toBeGreaterThan(0);
});

test('login real, configuração, grade persistida, edição, desfazer e atividade', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8); await login(page);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da nova vaga' }).fill(`Analista ${suffix}`); await page.getByRole('button', { name: 'Criar vaga', exact: true }).click();
  await expect(page.getByText(`Analista ${suffix}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Novo campo', exact: true }).click();
  await page.getByLabel('Nome da coluna').fill(`Nota ${suffix}`); await page.getByLabel('Tipo', { exact: true }).selectOption('number'); await page.getByLabel('Mínimo', { exact: true }).fill('0'); await page.getByLabel('Máximo', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Salvar campo', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Candidaturas', exact: true }).click(); await page.getByRole('button', { name: 'Nova candidatura', exact: true }).click();
  await page.getByLabel('Vaga', { exact: true }).selectOption({ label: `Analista ${suffix}` }); await page.getByLabel('Nome completo').fill(`Pessoa ${suffix}`); await page.getByLabel('E-mail', { exact: true }).fill(`${suffix}@example.test`); await page.getByLabel(`Nota ${suffix}`, { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Criar candidatura', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Buscar candidaturas').fill(suffix); await expect(page.getByRole('gridcell', { name: `Pessoa ${suffix}` })).toBeVisible(); await page.reload(); await page.getByLabel('Buscar candidaturas').fill(suffix);
  const cell = page.getByRole('row').filter({ hasText: `Pessoa ${suffix}` }).getByRole('gridcell', { name: '10', exact: true }); await cell.dblclick();
  await page.getByLabel(`Nota ${suffix}`, { exact: true }).fill('20'); await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Alteração salva');
  await expect(page.getByRole('row').filter({ hasText: `Pessoa ${suffix}` }).getByRole('gridcell', { name: '20', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await expect(page.getByRole('status')).toContainText('desfeita');
  await page.screenshot({ path: '.local/grid.png', fullPage: true });
  await page.getByRole('button', { name: 'Atividade', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Histórico de auditoria' })).toBeVisible();
});
