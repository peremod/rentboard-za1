import { Page, expect } from '@playwright/test';

/** Unique per run, so tests can be run repeatedly against the same database. */
export function uniqueEmail(prefix: string) {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@rentboard.test`;
}

export const PASSWORD = 'SmokeTest123';

export async function register(page: Page, role: 'tenant' | 'landlord', email: string) {
  await page.goto('/auth/register');
  await page.getByText(role === 'tenant' ? "I'm looking for a room" : 'I have a room to let').click();
  await page.getByLabel('Full name').fill(role === 'tenant' ? 'E2E Tenant' : 'E2E Landlord');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/dashboard`));
}

export async function login(page: Page, email: string) {
  await page.goto('/auth/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /log out/i }).first().click();
  await expect(page).toHaveURL(/\/(auth\/login)?$/);
}

/**
 * Publishes a room and returns its title.
 *
 * Walks the real wizard rather than seeding through the API, because the
 * wizard is where the bugs have been — a step that silently created a second
 * listing, photos that vanished on edit, preferences reset on save.
 */
export async function publishRoom(page: Page, title: string) {
  await page.goto('/landlord/rooms/new');

  await page.getByLabel('Room type').selectOption({ index: 1 });
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(
    'A bright room in a quiet house, close to transport and shops. Suitable for a working professional or student.',
  );
  await page.getByRole('button', { name: /next/i }).click();

  await page.getByLabel('Monthly rent (ZAR)').fill('3500');
  await page.getByLabel('Province').selectOption('Gauteng');
  await page.getByLabel('City / suburb').fill('Johannesburg');
  await page.getByLabel('Location display').fill('Braamfontein, Johannesburg');
  await page.getByLabel('Available from').fill('2026-12-01');
  await page.getByRole('button', { name: /next/i }).click();

  await page.getByRole('button', { name: /next/i }).click();   // preferences
  return title;
}
