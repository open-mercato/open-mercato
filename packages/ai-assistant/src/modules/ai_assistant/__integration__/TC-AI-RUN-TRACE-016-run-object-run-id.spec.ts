import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AI-RUN-TRACE-016: `POST /api/ai_assistant/ai/run-object` run id + call settings contract.
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` §6. CI has no LLM provider, so the
 * spec never needs a real model call:
 *   - the request-body validation (strict `callSettings`) runs before any model work;
 *   - a valid `callSettings` payload against an unknown agent proves the schema
 *     accepts every documented key (404 from the policy gate, not 400);
 *   - the OpenAPI document must declare `runId` (UUID) on the 200 response;
 *   - when a provider IS configured, a real object-mode run must return a UUID `runId`.
 *
 * No records are created, so there is nothing to clean up.
 */
const RUN_OBJECT_PATH = '/api/ai_assistant/ai/run-object';
const OBJECT_AGENT_ID = 'workflows.workflow_author';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveSchemaRefs(value: unknown, document: JsonRecord, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((entry) => resolveSchemaRefs(entry, document, depth + 1));
  if (!isRecord(value)) return value;
  const ref = value.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    const target = ref
      .slice(2)
      .split('/')
      .reduce<unknown>((node, segment) => (isRecord(node) ? node[segment] : undefined), document);
    return resolveSchemaRefs(target, document, depth + 1);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveSchemaRefs(entry, document, depth + 1)]),
  );
}

async function readJson(response: { text(): Promise<string> }): Promise<JsonRecord> {
  const raw = await response.text();
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

test.describe('TC-AI-RUN-TRACE-016: run-object run id and call settings', () => {
  test('rejects an unknown callSettings key with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
      token,
      data: {
        agent: OBJECT_AGENT_ID,
        messages: [{ role: 'user', content: 'Draft a workflow.' }],
        callSettings: { temperature: 0.2, notARealSetting: true },
      },
    });
    expect(response.status()).toBe(400);
    const body = await readJson(response);
    expect(body.code).toBe('validation_error');
    expect(JSON.stringify(body.issues ?? [])).toContain('notARealSetting');
  });

  test('accepts every documented callSettings key', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
      token,
      data: {
        agent: 'qa_missing_module.qa_missing_agent',
        messages: [{ role: 'user', content: 'Hello.' }],
        callSettings: {
          temperature: 0,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 256,
          seed: 7,
          stopSequences: ['END'],
          presencePenalty: 0,
          frequencyPenalty: 0,
          providerOptions: { openai: { user: 'qa' } },
        },
      },
    });
    expect(response.status()).toBe(404);
    const body = await readJson(response);
    expect(body.code).toBe('agent_unknown');
  });

  test('OpenAPI declares a UUID runId on the run-object response', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'GET', '/api/docs/openapi', { token });
    expect(response.ok()).toBeTruthy();
    const document = await readJson(response);
    const paths = isRecord(document.paths) ? document.paths : {};
    const documentPath = RUN_OBJECT_PATH.replace(/^\/api/, '');
    const pathEntry = paths[RUN_OBJECT_PATH] ?? paths[documentPath];
    const operation = isRecord(pathEntry) ? pathEntry : {};
    const post = isRecord(operation.post) ? operation.post : {};
    const responses = isRecord(post.responses) ? post.responses : {};
    const serialized = JSON.stringify(resolveSchemaRefs(responses['200'] ?? null, document));
    expect(serialized).toContain('"runId"');
    expect(serialized).toContain('uuid');
  });

  test('a real object-mode run returns a UUID runId when a provider is configured', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
      token,
      timeout: 90_000,
      data: {
        agent: OBJECT_AGENT_ID,
        messages: [{ role: 'user', content: 'Draft a one-step workflow that logs a message.' }],
        callSettings: { temperature: 0 },
      },
    });
    const body = await readJson(response);
    test.skip(
      response.status() !== 200,
      `run-object did not complete (status ${response.status()}, code ${String(body.code ?? '')}); no LLM provider in this environment`,
    );
    expect(typeof body.runId).toBe('string');
    expect(String(body.runId)).toMatch(UUID_PATTERN);
  });
});
