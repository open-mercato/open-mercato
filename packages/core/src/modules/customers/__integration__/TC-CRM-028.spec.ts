import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { BootstrapData } from '@open-mercato/shared/lib/bootstrap';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
import { createQueue } from '@open-mercato/queue';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato/.env') });

const APP_ROOT = path.resolve(process.cwd(), 'apps/mercato');
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue');
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const EXAMPLE_CUSTOMERS_SYNC_API_BASE = '/api/example-customers-sync';
const SYNC_TOGGLE_IDS = {
  enabled: 'example.customers_sync.enabled',
  bidirectional: 'example.customers_sync.bidirectional',
} as const;
const EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE = 'example-customers-sync-outbound';
const EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE = 'example-customers-sync-inbound';
const EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE = 'example-customers-sync-reconcile';

process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR;

type TokenScope = ReturnType<typeof getTokenScope>;

type ScopedRequestOptions = {
  token: string;
  data?: unknown;
  tenantId?: string | null;
  organizationId?: string | null;
};

type MappingItem = {
  id: string;
  interactionId: string;
  todoId: string;
  syncStatus: string;
  exampleHref: string;
  lastError?: string | null;
};

type ExampleTodoItem = {
  id: string;
  title: string;
  is_done?: boolean;
  cf_priority?: number | null;
  cf_description?: string | null;
  cf_severity?: string | null;
};

type CustomerTodoItem = {
  id: string;
  todoId: string;
  todoTitle: string | null;
  todoIsDone: boolean | null;
  todoPriority?: number | null;
  todoDescription?: string | null;
  todoSeverity?: string | null;
  todoSource: string;
};

const toggleIdCache = new Map<string, string>();
let sharedDbClient: Client | null = null;
let sharedDbClientPromise: Promise<Client> | null = null;
let bootstrapDataPromise: Promise<BootstrapData> | null = null;

function resolveUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

function buildCookieHeader(scope: {
  tenantId?: string | null;
  organizationId?: string | null;
}): string | undefined {
  const parts: string[] = [];
  if (typeof scope.tenantId === 'string' && scope.tenantId.length > 0) {
    parts.push(`om_selected_tenant=${scope.tenantId}`);
  }
  if (typeof scope.organizationId === 'string' && scope.organizationId.length > 0) {
    parts.push(`om_selected_org=${scope.organizationId}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

async function getDbClient(): Promise<Client> {
  if (sharedDbClient) return sharedDbClient;
  if (sharedDbClientPromise) return sharedDbClientPromise;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for direct DB assertions in TC-CRM-028');
  }
  sharedDbClientPromise = (async () => {
    const client = new Client({ connectionString });
    await client.connect();
    sharedDbClient = client;
    return client;
  })();
  return sharedDbClientPromise;
}

async function closeDbClient(): Promise<void> {
  const client = sharedDbClient;
  sharedDbClient = null;
  sharedDbClientPromise = null;
  if (client) {
    await client.end();
  }
}

async function getBootstrapData(): Promise<BootstrapData> {
  if (!bootstrapDataPromise) {
    bootstrapDataPromise = bootstrapFromAppRoot(APP_ROOT);
  }
  return bootstrapDataPromise;
}

function hasSyncWorkers(data: BootstrapData): boolean {
  return data.modules
    .flatMap((module) => module.workers ?? [])
    .some((entry) => entry.queue === EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE);
}

async function drainQueue(queueName: string): Promise<number> {
  const data = await getBootstrapData();
  const worker = data.modules
    .flatMap((module) => module.workers ?? [])
    .find((entry) => entry.queue === queueName);
  if (!worker) {
    return 0;
  }

  const container = await createRequestContainer();
  const queue = createQueue(queueName, 'local', { baseDir: APP_QUEUE_BASE_DIR, concurrency: 1 });
  const resolve = <T = unknown>(name: string): T => container.resolve(name) as T;

  try {
    let processedJobs = 0;
    while (true) {
      const result = await queue.process(
        async (job, ctx) => {
          await Promise.resolve(worker.handler(job, { ...ctx, resolve }));
        },
        { limit: 100 },
      );
      const handled = result.processed + result.failed;
      processedJobs += handled;
      if (handled === 0) {
        return processedJobs;
      }
    }
  } finally {
    await queue.close();
  }
}

async function flushExampleCustomersSyncQueues(options: {
  outbound?: boolean;
  inbound?: boolean;
  reconcile?: boolean;
} = {}): Promise<void> {
  if (options.outbound ?? true) {
    await drainQueue(EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE);
  }
  if (options.inbound ?? false) {
    await drainQueue(EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE);
  }
  if (options.reconcile ?? false) {
    await drainQueue(EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE);
  }
}

async function findFeatureToggleIdInDb(identifier: string): Promise<string | null> {
  const client = await getDbClient();
  const result = await client.query<{ id: string }>(
    `
      select id
      from feature_toggles
      where identifier = $1
        and deleted_at is null
      limit 1
    `,
    [identifier],
  );
  return result.rows[0]?.id ?? null;
}

async function scopedApiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: ScopedRequestOptions,
): Promise<APIResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  };
  const cookie = buildCookieHeader(options);
  if (cookie) headers.Cookie = cookie;
  return request.fetch(resolveUrl(path), {
    method,
    headers,
    data: options.data,
  });
}

async function resolveToggleId(
  request: APIRequestContext,
  token: string,
  identifier: string,
): Promise<string> {
  const cached = toggleIdCache.get(identifier);
  if (cached) return cached;

  const response = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global?page=1&pageSize=100&identifier=${encodeURIComponent(identifier)}`,
    { token },
  );
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: Array<{ id?: string; identifier?: string }> }>(response);
  const toggle = (body?.items ?? []).find((item) => item.identifier === identifier);
  if (toggle?.id) {
    const toggleId = expectId(toggle.id, `Missing toggle id for ${identifier}`);
    toggleIdCache.set(identifier, toggleId);
    return toggleId;
  }

  const existingToggleId = await findFeatureToggleIdInDb(identifier);
  if (existingToggleId) {
    toggleIdCache.set(identifier, existingToggleId);
    return existingToggleId;
  }
  throw new Error(`Missing feature toggle ${identifier}. Run migrations for example_customers_sync before TC-CRM-028.`);
}

async function setBooleanOverride(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  value: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    data: {
      toggleId,
      isOverride: true,
      overrideValue: value,
    },
  });
  expect(response.status()).toBe(200);
}

async function clearOverride(
  request: APIRequestContext,
  token: string,
  toggleId: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    data: {
      toggleId,
      isOverride: false,
    },
  });
  expect(response.status()).toBe(200);
}

async function setSyncFlags(
  request: APIRequestContext,
  token: string,
  flags: { enabled: boolean; bidirectional: boolean },
): Promise<void> {
  const enabledToggleId = await resolveToggleId(request, token, SYNC_TOGGLE_IDS.enabled);
  const bidirectionalToggleId = await resolveToggleId(request, token, SYNC_TOGGLE_IDS.bidirectional);
  await setBooleanOverride(request, token, enabledToggleId, flags.enabled);
  await setBooleanOverride(request, token, bidirectionalToggleId, flags.bidirectional);
}

async function clearSyncFlagOverrides(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const enabledToggleId = await resolveToggleId(request, token, SYNC_TOGGLE_IDS.enabled);
  const bidirectionalToggleId = await resolveToggleId(request, token, SYNC_TOGGLE_IDS.bidirectional);
  await clearOverride(request, token, enabledToggleId);
  await clearOverride(request, token, bidirectionalToggleId);
}

async function createScopedCompany(
  request: APIRequestContext,
  token: string,
  displayName: string,
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<string> {
  const response = await scopedApiRequest(request, 'POST', '/api/customers/companies', {
    token,
    data: { displayName },
    ...scope,
  });
  expect(response.status()).toBe(201);
  const body = await readJsonSafe<{ id?: string; entityId?: string }>(response);
  return expectId(body?.id ?? body?.entityId, 'Company create response should include an id');
}

async function createInteraction(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<string> {
  const response = scope
    ? await scopedApiRequest(request, 'POST', '/api/customers/interactions', { token, data, ...scope })
    : await apiRequest(request, 'POST', '/api/customers/interactions', { token, data });
  expect(response.status()).toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Interaction create response should include an id');
}

async function createExampleTodo(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<string> {
  const response = scope
    ? await scopedApiRequest(request, 'POST', '/api/example/todos', { token, data, ...scope })
    : await apiRequest(request, 'POST', '/api/example/todos', { token, data });
  expect(response.status()).toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Example todo create response should include an id');
}

async function listMappings(
  request: APIRequestContext,
  token: string,
  query: { interactionId?: string; todoId?: string } = {},
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<MappingItem[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (query.interactionId) params.set('interactionId', query.interactionId);
  if (query.todoId) params.set('todoId', query.todoId);
  const response = scope
    ? await scopedApiRequest(
        request,
        'GET',
        `${EXAMPLE_CUSTOMERS_SYNC_API_BASE}/mappings?${params.toString()}`,
        { token, ...scope },
      )
    : await apiRequest(request, 'GET', `${EXAMPLE_CUSTOMERS_SYNC_API_BASE}/mappings?${params.toString()}`, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: MappingItem[] }>(response);
  return body?.items ?? [];
}

async function findExampleTodoById(
  request: APIRequestContext,
  token: string,
  todoId: string,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<ExampleTodoItem | null> {
  const response = scope
    ? await scopedApiRequest(
        request,
        'GET',
        `/api/example/todos?id=${encodeURIComponent(todoId)}&page=1&pageSize=10`,
        { token, ...scope },
      )
    : await apiRequest(
        request,
        'GET',
        `/api/example/todos?id=${encodeURIComponent(todoId)}&page=1&pageSize=10`,
        { token },
      );
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: ExampleTodoItem[] }>(response);
  return (body?.items ?? []).find((item) => item.id === todoId) ?? null;
}

async function listCustomerTodos(
  request: APIRequestContext,
  token: string,
  entityId: string,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<CustomerTodoItem[]> {
  const response = scope
    ? await scopedApiRequest(
        request,
        'GET',
        `/api/customers/todos?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=100`,
        { token, ...scope },
      )
    : await apiRequest(
        request,
        'GET',
        `/api/customers/todos?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=100`,
        { token },
      );
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items?: CustomerTodoItem[] }>(response);
  return body?.items ?? [];
}

async function waitForMapping(
  request: APIRequestContext,
  token: string,
  query: { interactionId?: string; todoId?: string },
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<MappingItem> {
  let mapping: MappingItem | null = null;
  await expect
    .poll(async () => {
      const items = await listMappings(request, token, query, scope);
      mapping = items[0] ?? null;
      return mapping ? mapping.todoId : null;
    }, { timeout: 15_000, intervals: [250, 500, 1_000] })
    .not.toBeNull();
  if (!mapping) {
    throw new Error('Expected example customer sync mapping to be available');
  }
  return mapping;
}

async function waitForMappingRemoval(
  request: APIRequestContext,
  token: string,
  query: { interactionId?: string; todoId?: string },
): Promise<void> {
  await expect
    .poll(async () => (await listMappings(request, token, query)).length, {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
    })
    .toBe(0);
}

async function listInteractionActionLogCommandIds(interactionId: string): Promise<string[]> {
  const client = await getDbClient();
  const result = await client.query<{ command_id: string }>(
    `
      select command_id
      from action_logs
      where resource_kind = 'customers.interaction'
        and resource_id = $1
        and deleted_at is null
      order by created_at desc
      limit 20
    `,
    [interactionId],
  );
  return result.rows.map((row) => row.command_id);
}

async function waitForExampleTodo(
  request: APIRequestContext,
  token: string,
  todoId: string,
  expectation: (todo: ExampleTodoItem) => boolean,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<ExampleTodoItem> {
  let current: ExampleTodoItem | null = null;
  await expect
    .poll(async () => {
      current = await findExampleTodoById(request, token, todoId, scope);
      return current && expectation(current) ? current.id : null;
    }, { timeout: 15_000, intervals: [250, 500, 1_000] })
    .not.toBeNull();
  if (!current) {
    throw new Error(`Expected example todo ${todoId} to satisfy the awaited condition`);
  }
  return current;
}

async function waitForExampleTodoRemoval(
  request: APIRequestContext,
  token: string,
  todoId: string,
): Promise<void> {
  await expect
    .poll(async () => (await findExampleTodoById(request, token, todoId))?.id ?? null, {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
    })
    .toBeNull();
}

async function insertLegacyTodoLink(input: {
  organizationId: string;
  tenantId: string;
  todoId: string;
  entityId: string;
  createdByUserId: string;
}): Promise<string> {
  const client = await getDbClient();
  const result = await client.query<{ id: string }>(
    `
      insert into customer_todo_links (
        organization_id,
        tenant_id,
        todo_id,
        todo_source,
        created_at,
        created_by_user_id,
        entity_id
      )
      values ($1, $2, $3, 'example:todo', now(), $4, $5)
      returning id
    `,
    [input.organizationId, input.tenantId, input.todoId, input.createdByUserId, input.entityId],
  );
  return expectId(result.rows[0]?.id, 'Legacy todo link insert should return an id');
}

async function cleanupDbRows(input: {
  linkIds?: string[];
  todoIds?: string[];
  interactionIds?: string[];
  organizationIds?: string[];
}): Promise<void> {
  const client = await getDbClient();
  if (input.linkIds && input.linkIds.length > 0) {
    await client.query('delete from customer_todo_links where id = any($1::uuid[])', [input.linkIds]);
  }
  if (input.interactionIds && input.interactionIds.length > 0) {
    await client.query(
      'delete from example_customer_interaction_mappings where interaction_id = any($1::uuid[])',
      [input.interactionIds],
    );
  }
  if (input.todoIds && input.todoIds.length > 0) {
    await client.query(
      'delete from example_customer_interaction_mappings where todo_id = any($1::uuid[])',
      [input.todoIds],
    );
  }
  if (input.organizationIds && input.organizationIds.length > 0) {
    await client.query(
      'delete from example_customer_interaction_mappings where organization_id = any($1::uuid[])',
      [input.organizationIds],
    );
    await client.query(
      "delete from customer_todo_links where organization_id = any($1::uuid[]) and todo_source = 'example:todo'",
      [input.organizationIds],
    );
  }
}

test.describe('TC-CRM-028: Example customer sync', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let superadminToken: string;
  let adminScope: TokenScope;

  test.beforeAll(async ({ request }) => {
    const data = await getBootstrapData();
    test.skip(!hasSyncWorkers(data), 'example_customers_sync workers not registered — skipping sync tests');
    adminToken = await getAuthToken(request, 'admin');
    superadminToken = await getAuthToken(request, 'superadmin');
    adminScope = getTokenScope(adminToken);
  });

  test.beforeEach(async ({ request }) => {
    await clearSyncFlagOverrides(request, superadminToken);
    await flushExampleCustomersSyncQueues({ outbound: true, inbound: true });
  });

  test.afterEach(async ({ request }) => {
    await clearSyncFlagOverrides(request, superadminToken);
    await flushExampleCustomersSyncQueues({ outbound: true, inbound: true });
  });

  test.afterAll(async () => {
    await closeDbClient();
  });

  test('registers the example_customers_sync outbound worker in bootstrap data', async () => {
    const bootstrap = await getBootstrapData();
    const syncModule = bootstrap.modules.find((module) => module.id === 'example_customers_sync');
    expect(syncModule).toBeTruthy();
    expect(syncModule?.workers?.some((worker) => worker.queue === EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE)).toBe(true);
  });

  test('syncs canonical customer task lifecycle to example todos and exposes mappings', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;
    let todoId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: false });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Sync ${Date.now()}`);
      interactionId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'task',
        title: `CRM027 lifecycle ${Date.now()}`,
        body: 'Follow up with procurement',
        priority: 3,
        customValues: { severity: 'critical' },
      });
      await flushExampleCustomersSyncQueues({ outbound: true });

      const mapping = await waitForMapping(request, superadminToken, { interactionId });
      todoId = mapping.todoId;
      expect(mapping.syncStatus).toBe('synced');
      expect(mapping.exampleHref).toContain(todoId);

      const todo = await waitForExampleTodo(request, adminToken, todoId, (item) => item.cf_severity === 'high');
      expect(todo.title).toContain('CRM027 lifecycle');
      expect(todo.is_done).toBe(false);
      expect(todo.cf_priority).toBe(3);
      expect(todo.cf_description).toBe('Follow up with procurement');
      expect(todo.cf_severity).toBe('high');

      const completeResponse = await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token: adminToken,
        data: { id: interactionId },
      });
      expect(completeResponse.status()).toBe(200);
      await flushExampleCustomersSyncQueues({ outbound: true });

      const completedTodo = await waitForExampleTodo(request, adminToken, todoId, (item) => item.is_done === true);
      expect(completedTodo.is_done).toBe(true);

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/customers/interactions?id=${encodeURIComponent(interactionId)}`,
        { token: adminToken },
      );
      expect(deleteResponse.status()).toBe(200);
      interactionId = null;
      await flushExampleCustomersSyncQueues({ outbound: true });

      await waitForExampleTodoRemoval(request, adminToken, todoId);
      await waitForMappingRemoval(request, adminToken, { todoId });
      todoId = null;
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId);
      await cleanupDbRows({
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: todoId ? [todoId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('creates a canonical interaction when a linked example todo is created', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;
    let todoId: string | null = null;
    let linkId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: true });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Inbound Create ${Date.now()}`);
      todoId = randomUUID();
      linkId = await insertLegacyTodoLink({
        organizationId: adminScope.organizationId,
        tenantId: adminScope.tenantId,
        todoId,
        entityId: companyId,
        createdByUserId: adminScope.userId,
      });

      const createdTodoId = await createExampleTodo(request, adminToken, {
        id: todoId,
        title: `CRM027 inbound create ${Date.now()}`,
        customValues: {
          priority: 2,
          description: 'Created from example.todo.created',
          severity: 'high',
        },
      });
      expect(createdTodoId).toBe(todoId);
      await flushExampleCustomersSyncQueues({ inbound: true, outbound: false });

      const mapping = await waitForMapping(request, superadminToken, { todoId });
      interactionId = mapping.interactionId;
      expect(interactionId).toBe(todoId);

      await expect
        .poll(async () => {
          const rows = await listCustomerTodos(request, adminToken, companyId!);
          const row = rows.find((item) => item.id === interactionId);
          return row
            ? {
                title: row.todoTitle,
                priority: row.todoPriority ?? null,
                description: row.todoDescription ?? null,
                severity: row.todoSeverity ?? null,
              }
            : null;
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toEqual({
          title: expect.stringContaining('CRM027 inbound create'),
          priority: 2,
          description: 'Created from example.todo.created',
          severity: 'high',
        });
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId);
      await cleanupDbRows({
        linkIds: linkId ? [linkId] : [],
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: todoId ? [todoId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('routes inbound todo completion through the canonical complete command', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;
    let todoId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: true });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Inbound Complete ${Date.now()}`);
      interactionId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'task',
        title: `CRM027 inbound complete ${Date.now()}`,
        body: 'Complete me from example',
        priority: 2,
      });
      await flushExampleCustomersSyncQueues({ outbound: true });

      const mapping = await waitForMapping(request, superadminToken, { interactionId });
      todoId = mapping.todoId;

      const updateResponse = await apiRequest(request, 'PUT', '/api/example/todos', {
        token: adminToken,
        data: {
          id: todoId,
          is_done: true,
          title: `CRM027 inbound complete ${Date.now()}`,
        },
      });
      expect(updateResponse.status()).toBe(200);
      await flushExampleCustomersSyncQueues({ inbound: true, outbound: false });

      await expect
        .poll(async () => {
          const rows = await listCustomerTodos(request, adminToken, companyId!);
          return rows.find((item) => item.id === interactionId)?.todoIsDone ?? null;
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toBe(true);

      await expect
        .poll(async () => await listInteractionActionLogCommandIds(interactionId!), {
          timeout: 15_000,
          intervals: [250, 500, 1_000],
        })
        .toContain('customers.interactions.complete');
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId);
      await cleanupDbRows({
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: todoId ? [todoId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('skips sync side effects while the feature is disabled', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: false, bidirectional: false });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Disabled ${Date.now()}`);
      const title = `CRM027 disabled ${Date.now()}`;
      interactionId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'task',
        title,
      });
      await flushExampleCustomersSyncQueues({ outbound: true });

      await expect
        .poll(async () => {
          const targetInteractionId = expectId(
            interactionId,
            'Disabled sync assertion requires a created interaction id',
          );
          return (await listMappings(request, superadminToken, { interactionId: targetInteractionId })).length;
        }, {
          timeout: 5_000,
          intervals: [250, 500, 1_000],
        })
        .toBe(0);
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await cleanupDbRows({ interactionIds: interactionId ? [interactionId] : [] });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('persists an error mapping when the first outbound sync attempt fails', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: false });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Error ${Date.now()}`);
      interactionId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'task',
        title: 'x'.repeat(201),
      });
      await flushExampleCustomersSyncQueues({ outbound: true });

      const mapping = await waitForMapping(request, superadminToken, { interactionId });
      expect(mapping.todoId).toBe(interactionId);
      expect(mapping.syncStatus).toBe('error');
      expect(mapping.lastError).toBeTruthy();
      expect(await findExampleTodoById(request, adminToken, interactionId)).toBeNull();
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await cleanupDbRows({
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: interactionId ? [interactionId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('uses the loop guard and propagates inbound field clears', async ({ request }) => {
    let companyId: string | null = null;
    let interactionId: string | null = null;
    let todoId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: true });
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Loop ${Date.now()}`);
      interactionId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'task',
        title: `CRM027 loop ${Date.now()}`,
        body: 'Keep me in sync',
        priority: 4,
        customValues: { severity: 'critical' },
      });
      await flushExampleCustomersSyncQueues({ outbound: true });

      const mapping = await waitForMapping(request, superadminToken, { interactionId });
      todoId = mapping.todoId;

      await expect
        .poll(async () => {
          const rows = await listCustomerTodos(request, adminToken, companyId!);
          const row = rows.find((item) => item.id === interactionId);
          return row?.todoSeverity ?? null;
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toBe('critical');

      const updateResponse = await apiRequest(request, 'PUT', '/api/example/todos', {
        token: adminToken,
        data: {
          id: todoId,
          title: `CRM027 loop ${Date.now()}`,
          customValues: {
            priority: null,
            description: null,
            severity: null,
          },
        },
      });
      expect(updateResponse.status()).toBe(200);
      await flushExampleCustomersSyncQueues({ inbound: true, outbound: false });

      await expect
        .poll(async () => {
          const rows = await listCustomerTodos(request, adminToken, companyId!);
          const row = rows.find((item) => item.id === interactionId);
          return row
            ? {
                priority: row.todoPriority ?? null,
                description: row.todoDescription ?? null,
                severity: row.todoSeverity ?? null,
              }
            : null;
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toEqual({
          priority: null,
          description: null,
          severity: null,
        });
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId);
      await cleanupDbRows({
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: todoId ? [todoId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('reconcile backfills legacy example todo links into canonical interactions', async ({ request }) => {
    let companyId: string | null = null;
    let todoId: string | null = null;
    let interactionId: string | null = null;
    let linkId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 Reconcile ${Date.now()}`);
      todoId = await createExampleTodo(request, adminToken, {
        title: `CRM027 reconcile ${Date.now()}`,
        customValues: {
          priority: 2,
          description: 'Legacy bridge task',
          severity: 'high',
        },
      });
      linkId = await insertLegacyTodoLink({
        organizationId: adminScope.organizationId,
        tenantId: adminScope.tenantId,
        todoId,
        entityId: companyId,
        createdByUserId: adminScope.userId,
      });

      const reconcileResponse = await apiRequest(request, 'POST', `${EXAMPLE_CUSTOMERS_SYNC_API_BASE}/reconcile`, {
        token: superadminToken,
        data: {
          organizationId: adminScope.organizationId,
          tenantId: adminScope.tenantId,
          limit: 100,
        },
      });
      expect(reconcileResponse.status()).toBe(202);
      const reconcileBody = await readJsonSafe<{ queued?: number }>(reconcileResponse);
      expect(reconcileBody?.queued).toBe(1);

      await flushExampleCustomersSyncQueues({ outbound: false, inbound: false, reconcile: true });

      const mapping = await waitForMapping(request, superadminToken, { todoId });
      expect(mapping.interactionId).toBe(todoId);
      interactionId = mapping.interactionId;

      await expect
        .poll(async () => {
          const rows = await listCustomerTodos(request, adminToken, companyId!);
          const row = rows.find((item) => item.id === todoId);
          return row
            ? {
                title: row.todoTitle,
                priority: row.todoPriority ?? null,
                description: row.todoDescription ?? null,
                severity: row.todoSeverity ?? null,
              }
            : null;
        }, { timeout: 15_000, intervals: [250, 500, 1_000] })
        .toEqual({
          title: expect.stringContaining('CRM027 reconcile'),
          priority: 2,
          description: 'Legacy bridge task',
          severity: 'high',
        });
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId);
      await cleanupDbRows({
        linkIds: linkId ? [linkId] : [],
        interactionIds: interactionId ? [interactionId] : [],
        todoIds: todoId ? [todoId] : [],
      });
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });

  test('scopes the mappings API by organization', async ({ request }) => {
    let foreignOrganizationId: string | null = null;
    let foreignCompanyId: string | null = null;
    let foreignInteractionId: string | null = null;
    let foreignTodoId: string | null = null;

    try {
      await setSyncFlags(request, superadminToken, { enabled: true, bidirectional: false });

      const organizationResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: {
          tenantId: adminScope.tenantId,
          name: `QA CRM027 Foreign Org ${Date.now()}`,
        },
      });
      expect(organizationResponse.status()).toBe(201);
      const organizationBody = await readJsonSafe<{ id?: string }>(organizationResponse);
      foreignOrganizationId = expectId(organizationBody?.id, 'Organization create response should include an id');

      foreignCompanyId = await createScopedCompany(
        request,
        superadminToken,
        `QA CRM027 Foreign Company ${Date.now()}`,
        {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrganizationId,
        },
      );
      foreignInteractionId = await createInteraction(
        request,
        superadminToken,
        {
          entityId: foreignCompanyId,
          interactionType: 'task',
          title: `CRM027 foreign ${Date.now()}`,
        },
        {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrganizationId,
        },
      );
      await flushExampleCustomersSyncQueues({ outbound: true });

      const foreignMapping = await waitForMapping(
        request,
        superadminToken,
        { interactionId: foreignInteractionId },
        {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrganizationId,
        },
      );
      foreignTodoId = foreignMapping.todoId;

      expect(await listMappings(
        request,
        superadminToken,
        { interactionId: foreignInteractionId },
        {
          tenantId: adminScope.tenantId,
          organizationId: adminScope.organizationId,
        },
      )).toEqual([]);

      const visibleForeignMappings = await listMappings(
        request,
        superadminToken,
        { interactionId: foreignInteractionId },
        {
          tenantId: adminScope.tenantId,
          organizationId: foreignOrganizationId,
        },
      );
      expect(visibleForeignMappings).toHaveLength(1);
      expect(visibleForeignMappings[0]?.interactionId).toBe(foreignInteractionId);
    } finally {
      if (foreignInteractionId) {
        await scopedApiRequest(
          request,
          'DELETE',
          `/api/customers/interactions?id=${encodeURIComponent(foreignInteractionId)}`,
          {
            token: superadminToken,
            tenantId: adminScope.tenantId,
            organizationId: foreignOrganizationId,
          },
        ).catch(() => undefined);
      }
      if (foreignTodoId) {
        await scopedApiRequest(
          request,
          'DELETE',
          `/api/example/todos?id=${encodeURIComponent(foreignTodoId)}`,
          {
            token: superadminToken,
            tenantId: adminScope.tenantId,
            organizationId: foreignOrganizationId,
          },
        ).catch(() => undefined);
      }
      await cleanupDbRows({
        interactionIds: foreignInteractionId ? [foreignInteractionId] : [],
        todoIds: foreignTodoId ? [foreignTodoId] : [],
        organizationIds: foreignOrganizationId ? [foreignOrganizationId] : [],
      });
      if (foreignCompanyId) {
        await scopedApiRequest(
          request,
          'DELETE',
          `/api/customers/companies?id=${encodeURIComponent(foreignCompanyId)}`,
          {
            token: superadminToken,
            tenantId: adminScope.tenantId,
            organizationId: foreignOrganizationId,
          },
        ).catch(() => undefined);
      }
      if (foreignOrganizationId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/directory/organizations?id=${encodeURIComponent(foreignOrganizationId)}`,
          { token: superadminToken },
        ).catch(() => undefined);
      }
    }
  });
});
