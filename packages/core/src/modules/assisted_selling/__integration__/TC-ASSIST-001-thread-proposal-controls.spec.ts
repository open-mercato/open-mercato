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
 * TC-ASSIST-001 — the staff thread page offers write controls only to principals whose grants
 * the endpoints behind them accept (#8268 re-review finding 2, QA S03/S04/S06/E03), and every
 * control writes once however often it is clicked (#8268 QA S05c/S06c/E02/E03, #8417).
 *
 * The page itself only requires `assisted_selling.threads.view` + `cart.proposals.view`.
 * Creating, withdrawing and re-proposing additionally require `assisted_selling.proposals.author`
 * and `cart.proposals.author` (withdraw rejects the proposal cart through `cart.proposal.reject`);
 * join/leave/assign require `assisted_selling.threads.participate`; the composer requires
 * `assisted_selling.messages.post`. A viewer and a role holding only the first author feature
 * must see none of the controls they cannot use and be refused by the API; a full author drives
 * the whole create → withdraw → re-propose path.
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
type ThreadParticipant = { actorType: string; actorId: string | null; leftAt: string | null };
type ThreadMessage = { body: string };
type ThreadDetail = { participants: ThreadParticipant[]; messages: ThreadMessage[]; proposals: ThreadProposal[] };

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

async function readThreadDetail(request: APIRequestContext, adminToken: string, threadId: string): Promise<ThreadDetail> {
  const response = await apiRequest(request, 'GET', `/api/assisted_selling/threads/${threadId}`, { token: adminToken });
  expect(response.status(), `thread detail should be 200 (${await response.text()})`).toBe(200);
  const body = await readJsonSafe<Partial<ThreadDetail>>(response);
  return {
    participants: Array.isArray(body?.participants) ? body.participants : [],
    messages: Array.isArray(body?.messages) ? body.messages : [],
    proposals: Array.isArray(body?.proposals) ? body.proposals : [],
  };
}

async function readThreadProposals(request: APIRequestContext, adminToken: string, threadId: string): Promise<ThreadProposal[]> {
  return (await readThreadDetail(request, adminToken, threadId)).proposals;
}

function repParticipationsOf(detail: ThreadDetail, userId: string): ThreadParticipant[] {
  return detail.participants.filter((participant) => participant.actorType === 'rep' && participant.actorId === userId);
}

function trackAssistedSellingWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (outgoing) => {
    if (outgoing.method() !== 'POST') return;
    const { pathname } = new URL(outgoing.url());
    if (pathname.startsWith('/api/assisted_selling/')) writes.push(pathname);
  });
  return writes;
}

async function expectThreadWritesRefused(request: APIRequestContext, token: string, threadId: string): Promise<void> {
  const join = await apiRequest(request, 'POST', `/api/assisted_selling/threads/${threadId}/join`, { token, data: {} });
  expect(join.status(), 'thread join should be refused').toBe(403);
  const message = await apiRequest(request, 'POST', `/api/assisted_selling/threads/${threadId}/messages`, {
    token,
    data: { body: 'should not be posted' },
  });
  expect(message.status(), 'message post should be refused').toBe(403);
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

  test('a thread viewer sees no write controls and every write call is refused', async ({ page, request }) => {
    await signInStaff(page, viewer!.email);
    await openThreadPage(page, sharedThreadId);

    await expect(page.getByText('Awaiting the buyer').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New proposal', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Re-propose', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Leave', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign to me', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Write a message...' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);

    await expectThreadWritesRefused(request, viewer!.token, sharedThreadId);
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
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message...' })).toBeVisible();
  });

  test('a full author creates, withdraws and re-proposes from the thread page', async ({ page, request }) => {
    const threadId = await openThread(request, adminToken!, store!.hostname);
    await signInStaff(page, fullAuthor!.email);
    await openThreadPage(page, threadId);

    const newProposal = page.getByRole('button', { name: 'New proposal', exact: true });
    await expect(newProposal).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message...' })).toHaveCount(0);
    const refusedMessage = await apiRequest(request, 'POST', `/api/assisted_selling/threads/${threadId}/messages`, {
      token: fullAuthor!.token,
      data: { body: 'should not be posted' },
    });
    expect(refusedMessage.status(), 'message post without assisted_selling.messages.post should be refused').toBe(403);

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
    await expect(page.getByRole('button', { name: 'Re-propose', exact: true })).toHaveCount(0);
  });

  test('double clicks on Join, Withdraw, Re-propose and Send each write once', async ({ page, request }) => {
    const threadId = await openThread(request, adminToken!, store!.hostname);
    await authorProposal(request, wildcardAuthor!.token, threadId, product!.productId);
    const writes = trackAssistedSellingWrites(page);
    await signInStaff(page, wildcardAuthor!.email);
    await openThreadPage(page, threadId);

    await page.getByRole('button', { name: 'Join', exact: true }).dblclick();
    await expect(page.getByText('You joined this conversation.').first()).toBeVisible({ timeout: 30_000 });
    expect(writes.filter((path) => path.endsWith(`/threads/${threadId}/join`))).toHaveLength(1);
    await expect(page.getByText('Failed to join this conversation.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Withdraw', exact: true }).dblclick();
    await expect(page.getByText('Proposal withdrawn.').first()).toBeVisible({ timeout: 30_000 });
    expect(writes.filter((path) => path.endsWith('/withdraw'))).toHaveLength(1);
    await expect(page.getByText('Failed to withdraw this proposal.')).toHaveCount(0);
    expect((await readThreadProposals(request, adminToken!, threadId)).map((proposal) => proposal.status)).toEqual(['withdrawn']);

    await page.getByRole('button', { name: 'Re-propose', exact: true }).dblclick();
    await expect(page.getByText('New proposal authored.').first()).toBeVisible({ timeout: 30_000 });
    expect(writes.filter((path) => path.endsWith('/reauthor'))).toHaveLength(1);
    await expect(page.getByText('Failed to re-propose.')).toHaveCount(0);
    const afterRepropose = await readThreadProposals(request, adminToken!, threadId);
    expect(afterRepropose.map((proposal) => proposal.status).sort()).toEqual(['published', 'withdrawn']);
    await expect(page.getByRole('button', { name: 'Re-propose', exact: true })).toHaveCount(0);

    const messageBody = `QA double send ${randomUUID()}`;
    await page.getByRole('textbox', { name: 'Write a message...' }).fill(messageBody);
    await page.getByRole('button', { name: 'Send', exact: true }).dblclick();
    await expect(page.getByText('Message sent.').first()).toBeVisible({ timeout: 30_000 });
    expect(writes.filter((path) => path.endsWith(`/threads/${threadId}/messages`))).toHaveLength(1);

    const detail = await readThreadDetail(request, adminToken!, threadId);
    expect(detail.messages.filter((message) => message.body === messageBody)).toHaveLength(1);
    expect(repParticipationsOf(detail, wildcardAuthor!.userId)).toHaveLength(1);
  });

  test('two concurrent first joins by the same rep both succeed with one participant row', async ({ request }) => {
    const threadId = await openThread(request, adminToken!, store!.hostname);
    const joinOnce = () =>
      apiRequest(request, 'POST', `/api/assisted_selling/threads/${threadId}/join`, { token: fullAuthor!.token, data: {} });

    const responses = await Promise.all([joinOnce(), joinOnce()]);

    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const detail = await readThreadDetail(request, adminToken!, threadId);
    expect(repParticipationsOf(detail, fullAuthor!.userId)).toHaveLength(1);
  });
});
