import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  type CartProductFixture,
  type CartStorefrontFixture,
} from '@open-mercato/core/modules/cart/__integration__/helpers';

/**
 * TC-ASSIST-001 — the staff thread page offers proposal controls only to principals whose
 * grants the endpoints behind them accept (#8268 re-review finding 2, QA S03/S04/S06).
 *
 * The page itself only requires `assisted_selling.threads.view` + `cart.proposals.view`.
 * Creating, withdrawing and re-proposing additionally require `assisted_selling.proposals.author`
 * and `cart.proposals.author` (withdraw rejects the proposal cart through `cart.proposal.reject`).
 * A viewer and a role holding only the first author feature must see none of those controls and
 * be refused by the API; a full author drives the whole create → withdraw → re-propose path.
 *
 * Fixtures are created per run through the API (store in `rep` mode, priced product, guest
 * carts, one role + user per grant set). Users, roles, the product and the store are removed in
 * teardown; threads and proposal carts have no delete route and stay in the test database.
 *
 * Source: .ai/specs/2026-09-22-assisted-selling.md §6.1, §6.4, §7.
 */

const VIEWER_FEATURES = ['assisted_selling.threads.view', 'cart.proposals.view'];
const WITHDRAW_ONLY_FEATURES = [
  ...VIEWER_FEATURES,
  'assisted_selling.threads.participate',
  'assisted_selling.proposals.author',
];
const FULL_AUTHOR_FEATURES = [...WITHDRAW_ONLY_FEATURES, 'cart.proposals.author', 'catalog.products.view'];
const WILDCARD_FEATURES = ['assisted_selling.*', 'cart.proposals.*', 'catalog.products.view'];
const FIXTURE_PASSWORD = 'Valid1!Pass';

type StaffActor = { roleId: string; userId: string; email: string; token: string };
type ThreadProposal = { id: string; status: string };

function idempotencyKey(): string {
  return `qa-assist-${randomUUID()}`;
}

async function createStaffActor(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; stamp: string; features: string[] },
): Promise<StaffActor> {
  const { organizationId, tenantId } = getTokenContext(adminToken);
  const roleId = await createRoleFixture(request, adminToken, { name: `QA Assist ${input.label} ${input.stamp}`, tenantId });
  await setRoleAclFeatures(request, adminToken, { roleId, features: input.features, organizations: [organizationId] });
  const email = `qa-assist-${input.label}-${input.stamp}@test.invalid`;
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: FIXTURE_PASSWORD,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, FIXTURE_PASSWORD);
  return { roleId, userId, email, token };
}

async function deleteStaffActor(request: APIRequestContext, adminToken: string | null, actor: StaffActor | null): Promise<void> {
  if (!actor) return;
  await deleteUserIfExists(request, adminToken, actor.userId);
  await deleteRoleIfExists(request, adminToken, actor.roleId);
}

async function openThread(request: APIRequestContext, adminToken: string, hostname: string): Promise<string> {
  const { cartId } = await createStorefrontCart(hostname);
  const response = await apiRequest(request, 'POST', '/api/assisted_selling/threads', { token: adminToken, data: { cartId } });
  expect(response.status(), `thread open should be 201 (${await response.text()})`).toBe(201);
  const body = await readJsonSafe<{ result?: { threadId?: string } }>(response);
  return expectId(body?.result?.threadId, 'thread open should return a threadId');
}

async function authorProposal(
  request: APIRequestContext,
  token: string,
  threadId: string,
  productId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/assisted_selling/threads/${threadId}/proposals`, {
    token,
    data: { lines: [{ productId, quantity: '2' }], idempotencyKey: idempotencyKey() },
  });
  expect(response.status(), `proposal author should be 201 (${await response.text()})`).toBe(201);
  const body = await readJsonSafe<{ proposalId?: string }>(response);
  return expectId(body?.proposalId, 'proposal author should return a proposalId');
}

async function readThreadProposals(request: APIRequestContext, adminToken: string, threadId: string): Promise<ThreadProposal[]> {
  const response = await apiRequest(request, 'GET', `/api/assisted_selling/threads/${threadId}`, { token: adminToken });
  expect(response.status(), `thread detail should be 200 (${await response.text()})`).toBe(200);
  const body = await readJsonSafe<{ proposals?: ThreadProposal[] }>(response);
  return Array.isArray(body?.proposals) ? body.proposals : [];
}

async function expectAuthorCallsRefused(
  request: APIRequestContext,
  token: string,
  input: { threadId: string; proposalId: string; productId: string; includeCreate: boolean },
): Promise<void> {
  if (input.includeCreate) {
    const create = await apiRequest(request, 'POST', `/api/assisted_selling/threads/${input.threadId}/proposals`, {
      token,
      data: { lines: [{ productId: input.productId, quantity: '1' }], idempotencyKey: idempotencyKey() },
    });
    expect(create.status(), 'proposal create should be refused').toBe(403);
  }
  const withdraw = await apiRequest(request, 'POST', `/api/assisted_selling/proposals/${input.proposalId}/withdraw`, {
    token,
    data: {},
  });
  expect(withdraw.status(), 'proposal withdraw should be refused').toBe(403);
  const reauthor = await apiRequest(request, 'POST', `/api/assisted_selling/proposals/${input.proposalId}/reauthor`, {
    token,
    data: { idempotencyKey: idempotencyKey() },
  });
  expect(reauthor.status(), 'proposal re-author should be refused').toBe(403);
}

async function signInStaff(page: Page, email: string): Promise<void> {
  const form = new URLSearchParams({ email, password: FIXTURE_PASSWORD });
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `staff login should succeed (${response.status()})`).toBeTruthy();
  await acknowledgeGlobalNotices(page);
}

async function openThreadPage(page: Page, threadId: string): Promise<void> {
  const featureCheck = page.waitForResponse((response) => response.url().includes('/api/auth/feature-check'), {
    timeout: 60_000,
  });
  await page.goto(`/backend/assisted-selling/threads/${threadId}`, { waitUntil: 'domcontentloaded' });
  await featureCheck;
  await expect(page.getByText('Participants', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

test.describe('TC-ASSIST-001: thread page proposal controls follow the author grants', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let adminToken: string | null = null;
  let store: CartStorefrontFixture | null = null;
  let product: CartProductFixture | null = null;
  let productTitle = '';
  let viewer: StaffActor | null = null;
  let withdrawOnly: StaffActor | null = null;
  let fullAuthor: StaffActor | null = null;
  let wildcardAuthor: StaffActor | null = null;
  let sharedThreadId = '';
  let sharedProposalId = '';

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, adminToken);
    const settings = await apiRequest(request, 'PUT', `/api/assisted_selling/settings/${store.storeId}`, {
      token: adminToken,
      data: { mode: 'rep' },
    });
    expect(settings.status(), `store settings update should be 200 (${await settings.text()})`).toBe(200);
    product = await createCartProductFixture(request, adminToken, {
      stamp: store.stamp,
      label: 'assist',
      salesChannelId: store.salesChannelId,
    });
    productTitle = `QA Cart Product assist ${store.stamp}`;
    viewer = await createStaffActor(request, adminToken, { label: 'viewer', stamp: store.stamp, features: VIEWER_FEATURES });
    withdrawOnly = await createStaffActor(request, adminToken, {
      label: 'withdraw-only',
      stamp: store.stamp,
      features: WITHDRAW_ONLY_FEATURES,
    });
    fullAuthor = await createStaffActor(request, adminToken, {
      label: 'author',
      stamp: store.stamp,
      features: FULL_AUTHOR_FEATURES,
    });
    wildcardAuthor = await createStaffActor(request, adminToken, {
      label: 'wildcard',
      stamp: store.stamp,
      features: WILDCARD_FEATURES,
    });
    sharedThreadId = await openThread(request, adminToken, store.hostname);
    sharedProposalId = await authorProposal(request, adminToken, sharedThreadId, product.productId);
  });

  test.afterAll(async ({ request }) => {
    await deleteStaffActor(request, adminToken, viewer);
    await deleteStaffActor(request, adminToken, withdrawOnly);
    await deleteStaffActor(request, adminToken, fullAuthor);
    await deleteStaffActor(request, adminToken, wildcardAuthor);
    await cleanupCartProductFixture(request, adminToken, product);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  test('a thread viewer sees no author controls and every author call is refused', async ({ page, request }) => {
    await signInStaff(page, viewer!.email);
    await openThreadPage(page, sharedThreadId);

    await expect(page.getByText('Awaiting the buyer').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New proposal', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Re-propose', exact: true })).toHaveCount(0);

    await expectAuthorCallsRefused(request, viewer!.token, {
      threadId: sharedThreadId,
      proposalId: sharedProposalId,
      productId: product!.productId,
      includeCreate: true,
    });
    const proposals = await readThreadProposals(request, adminToken!, sharedThreadId);
    expect(proposals.find((proposal) => proposal.id === sharedProposalId)?.status).toBe('published');
  });

  test('a role with assisted_selling.proposals.author but not cart.proposals.author is offered no Withdraw', async ({ page, request }) => {
    await signInStaff(page, withdrawOnly!.email);
    await openThreadPage(page, sharedThreadId);

    await expect(page.getByText('Awaiting the buyer').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New proposal', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);

    await expectAuthorCallsRefused(request, withdrawOnly!.token, {
      threadId: sharedThreadId,
      proposalId: sharedProposalId,
      productId: product!.productId,
      includeCreate: true,
    });
    const proposals = await readThreadProposals(request, adminToken!, sharedThreadId);
    expect(proposals.find((proposal) => proposal.id === sharedProposalId)?.status).toBe('published');
  });

  test('wildcard author grants (assisted_selling.*, cart.proposals.*) show the author controls', async ({ page }) => {
    await signInStaff(page, wildcardAuthor!.email);
    await openThreadPage(page, sharedThreadId);

    await expect(page.getByText('Awaiting the buyer').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New proposal', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true }).first()).toBeVisible();
  });

  test('a full author creates, withdraws and re-proposes from the thread page', async ({ page, request }) => {
    const threadId = await openThread(request, adminToken!, store!.hostname);
    await signInStaff(page, fullAuthor!.email);
    await openThreadPage(page, threadId);

    const newProposal = page.getByRole('button', { name: 'New proposal', exact: true });
    await expect(newProposal).toBeVisible();

    await newProposal.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await newProposal.click();
    await expect(dialog).toBeVisible();
    const productField = dialog.getByRole('combobox').first();
    await expect(async () => {
      await productField.fill('');
      await productField.fill(productTitle);
      await expect(page.getByRole('option').filter({ hasText: productTitle }).first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
    await page.getByRole('option').filter({ hasText: productTitle }).first().click();
    const quantity = dialog.getByLabel('Quantity');
    await quantity.fill('2');
    await quantity.press('Control+Enter');

    await expect(page.getByText('Proposal published.').first()).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Awaiting the buyer').first()).toBeVisible({ timeout: 30_000 });
    const published = await readThreadProposals(request, adminToken!, threadId);
    expect(published.map((proposal) => proposal.status)).toEqual(['published']);

    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(page.getByText('Proposal withdrawn.').first()).toBeVisible({ timeout: 30_000 });
    const reproposeButton = page.getByRole('button', { name: 'Re-propose', exact: true });
    await expect(reproposeButton).toBeVisible({ timeout: 30_000 });
    const withdrawn = await readThreadProposals(request, adminToken!, threadId);
    expect(withdrawn.map((proposal) => proposal.status)).toEqual(['withdrawn']);

    await reproposeButton.click();
    await expect(page.getByText('New proposal authored.').first()).toBeVisible({ timeout: 30_000 });
    const reproposed = await readThreadProposals(request, adminToken!, threadId);
    expect(reproposed.map((proposal) => proposal.status).sort()).toEqual(['published', 'withdrawn']);
  });
});
