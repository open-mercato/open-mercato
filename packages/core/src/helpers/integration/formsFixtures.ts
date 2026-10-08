import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { readJsonSafe } from './generalFixtures';

/**
 * Forms integration fixtures.
 *
 * Modelled on `workflowsFixtures` — schema builders plus create/read/delete
 * helpers, all API-first so the same file works in the monorepo and standalone
 * lanes. Nothing here touches the database directly; the only records a spec
 * may assume exist are the three `mercato init` staff accounts.
 *
 * Two module behaviours drive most of the shapes below and are easy to get
 * wrong from the docs alone:
 *
 *  - A submission access token authorizes an `(submissionId, invitationId,
 *    role)` triple, so the anonymous runtime always goes through a
 *    distribution; `POST /api/forms/public/start` mints the invitation row for
 *    open-mode links itself.
 *  - `SubmissionService.save()` rate-limits consecutive autosaves to one per
 *    `FORMS_AUTOSAVE_INTERVAL_MS / 2` (5s on the shipped default) and counts
 *    from the revision `start` wrote, so the FIRST autosave after a start is
 *    throttled too. {@link waitForAutosaveWindow} is the wait every runtime
 *    spec needs before a `PATCH`; specs that chain saves must raise their own
 *    timeout with `test.setTimeout()`.
 */

type JsonRecord = Record<string, unknown>;

/** Matches the 5s floor `SubmissionService` derives from its 10s default. */
export const AUTOSAVE_MIN_INTERVAL_MS = 5_000;

/**
 * Sleeps past the autosave rate-limit floor. Without this a second `PATCH`
 * (or the first one after `start`) returns `429 RATE_LIMITED`, which reads like
 * a public-limiter hit but comes from the submission service.
 */
export async function waitForAutosaveWindow(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_MIN_INTERVAL_MS + 400));
}

/**
 * Retry-safe unique form key. `formKeySchema` demands 3-64 chars matching
 * `/^[a-z][a-z0-9_-]*$/`, and `(organization_id, key)` is unique, so a spec that
 * reuses a literal collides with its own Playwright retry.
 */
export function uniqueFormKey(prefix = 'qa_forms'): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`.toLowerCase();
}

/** Unique synthetic client IP so a spec owns its public rate-limit bucket. */
export function uniqueClientIp(): string {
  const octet = () => 1 + Math.floor(Number.parseInt(randomUUID().slice(0, 2), 16) / 1.05);
  return `203.0.${Math.min(254, octet())}.${Math.min(254, octet())}`;
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

/**
 * The canonical compilable schema: two declared roles, a participant-editable
 * required text field and a participant-editable textarea. Shape copied from
 * `__tests__/form-version-compiler.test.ts`, which is already proven to compile.
 */
export function buildMinimalFormSchema(): JsonRecord {
  return {
    type: 'object',
    'x-om-roles': ['admin', 'participant'],
    'x-om-default-actor-role': 'participant',
    'x-om-sections': [
      { key: 'identity', title: { en: 'Identity' }, fieldKeys: ['full_name', 'notes'] },
    ],
    properties: {
      full_name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        'x-om-type': 'text',
        'x-om-label': { en: 'Full name' },
        'x-om-editable-by': ['participant'],
        'x-om-visible-to': ['admin', 'participant'],
      },
      notes: {
        type: 'string',
        maxLength: 2000,
        'x-om-type': 'textarea',
        'x-om-label': { en: 'Notes' },
        'x-om-editable-by': ['participant'],
        'x-om-visible-to': ['admin', 'participant'],
      },
    },
    required: ['full_name'],
  };
}

/**
 * Adds an `x-om-sensitive` text field plus a non-sensitive enumerable boolean.
 * The anonymize and analytics-exclusion cases need all three field kinds in one
 * form: sensitive (tombstoned / never distributed), free-text (never
 * distributed) and enumerable (distributed as counts).
 */
export function buildSensitiveFormSchema(): JsonRecord {
  const schema = buildMinimalFormSchema();
  const properties = schema.properties as JsonRecord;
  properties.diagnosis = {
    type: 'string',
    maxLength: 500,
    'x-om-type': 'text',
    'x-om-label': { en: 'Diagnosis' },
    'x-om-editable-by': ['participant'],
    'x-om-visible-to': ['admin', 'participant'],
    'x-om-sensitive': true,
  };
  properties.consented = {
    type: 'boolean',
    'x-om-type': 'boolean',
    'x-om-label': { en: 'Consented?' },
    'x-om-editable-by': ['participant'],
    'x-om-visible-to': ['admin', 'participant'],
  };
  schema['x-om-sections'] = [
    {
      key: 'identity',
      title: { en: 'Identity' },
      fieldKeys: ['full_name', 'notes', 'diagnosis', 'consented'],
    },
  ];
  return schema;
}

/**
 * Adds an `x-om-type: 'file'` field. Without one `resolveFieldUploadConfig`
 * returns `null` and every upload answers `422 INVALID_FIELD`, so the whole
 * attachment area depends on this builder.
 */
export function buildFileFieldFormSchema(
  options: { accept?: string[]; maxSizeBytes?: number } = {},
): JsonRecord {
  const schema = buildMinimalFormSchema();
  const properties = schema.properties as JsonRecord;
  properties.scan = {
    type: 'array',
    'x-om-type': 'file',
    'x-om-label': { en: 'Scan' },
    'x-om-editable-by': ['participant'],
    'x-om-visible-to': ['admin', 'participant'],
    'x-om-accept': options.accept ?? ['image/png'],
    'x-om-max-size-bytes': options.maxSizeBytes ?? 4096,
  };
  schema['x-om-sections'] = [
    { key: 'identity', title: { en: 'Identity' }, fieldKeys: ['full_name', 'notes', 'scan'] },
  ];
  return schema;
}

/** A schema the compiler must reject: `full_name` is editable by an undeclared role. */
export function buildUncompilableFormSchema(): JsonRecord {
  return {
    type: 'object',
    'x-om-roles': ['admin', 'participant'],
    'x-om-default-actor-role': 'participant',
    properties: {
      full_name: {
        type: 'string',
        'x-om-type': 'text',
        'x-om-label': { en: 'Full name' },
        'x-om-editable-by': ['not_a_declared_role'],
      },
    },
  };
}

/** The smallest byte string Chromium and the upload gate both accept as a PNG. */
export function buildTinyPngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+DHkYAAAAAElFTkSuQmCC',
    'base64',
  );
}

// ---------------------------------------------------------------------------
// Form + version fixtures
// ---------------------------------------------------------------------------

export type FormFixture = { id: string; key: string };

export type CreateFormInput = {
  key?: string;
  name?: string;
  description?: string | null;
  defaultLocale?: string;
  supportedLocales?: string[];
  retentionDays?: number | null;
  /** Sends `om_selected_org` so the form lands in another organization. */
  selectedOrgId?: string;
};

function resolveUrl(path: string): string {
  const base = process.env.BASE_URL?.trim();
  return base ? `${base}${path}` : path;
}

export async function createFormFixture(
  request: APIRequestContext,
  token: string,
  input: CreateFormInput = {},
): Promise<FormFixture> {
  const key = input.key ?? uniqueFormKey();
  const data: JsonRecord = {
    key,
    name: input.name ?? `QA Forms ${key}`,
    defaultLocale: input.defaultLocale ?? 'en',
    supportedLocales: input.supportedLocales ?? ['en'],
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;

  const response = input.selectedOrgId
    ? await request.fetch(resolveUrl('/api/forms'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Cookie: `om_selected_org=${input.selectedOrgId}`,
        },
        data,
      })
    : await apiRequest(request, 'POST', '/api/forms', { token, data });

  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `POST /api/forms should return 201 (got ${response.status()})`).toBe(201);
  expect(typeof body?.id === 'string' && body.id.length > 0, 'form create should return an id').toBe(true);
  return { id: body!.id as string, key };
}

export async function forkDraftFixture(
  request: APIRequestContext,
  token: string,
  formId: string,
  fromVersionId?: string | null,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/forms/${formId}/versions/fork`, {
    token,
    data: fromVersionId ? { fromVersionId } : {},
  });
  const body = await readJsonSafe<{ versionId?: string }>(response);
  expect(response.status(), `fork should return 201 (got ${response.status()})`).toBe(201);
  expect(typeof body?.versionId === 'string' && body.versionId.length > 0, 'fork should return versionId').toBe(true);
  return body!.versionId as string;
}

export async function updateDraftFixture(
  request: APIRequestContext,
  token: string,
  formId: string,
  versionId: string,
  input: { schema?: JsonRecord; uiSchema?: JsonRecord; roles?: string[]; changelog?: string | null },
): Promise<void> {
  const response = await apiRequest(request, 'PATCH', `/api/forms/${formId}/versions/${versionId}`, {
    token,
    data: input,
  });
  expect(
    response.status(),
    `draft update should return 200 (got ${response.status()}: ${await response.text()})`,
  ).toBe(200);
}

export async function publishVersionFixture(
  request: APIRequestContext,
  token: string,
  formId: string,
  versionId: string,
  changelog?: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/forms/${formId}/versions/${versionId}/publish`,
    { token, data: changelog ? { changelog } : {} },
  );
  const body = await readJsonSafe<{ versionId?: string; versionNumber?: number }>(response);
  expect(
    response.status(),
    `publish should return 200 (got ${response.status()}: ${JSON.stringify(body)})`,
  ).toBe(200);
  return {
    versionId: body?.versionId ?? versionId,
    versionNumber: typeof body?.versionNumber === 'number' ? body.versionNumber : 0,
  };
}

export type PublishedFormFixture = {
  formId: string;
  formKey: string;
  versionId: string;
  versionNumber: number;
};

/** create → fork → update draft → publish, the composite most cases need. */
export async function createPublishedFormFixture(
  request: APIRequestContext,
  token: string,
  options: { schema?: JsonRecord; uiSchema?: JsonRecord; roles?: string[] } & CreateFormInput = {},
): Promise<PublishedFormFixture> {
  const { schema, uiSchema, roles, ...formInput } = options;
  const form = await createFormFixture(request, token, formInput);
  const versionId = await forkDraftFixture(request, token, form.id);
  await updateDraftFixture(request, token, form.id, versionId, {
    schema: schema ?? buildMinimalFormSchema(),
    uiSchema: uiSchema ?? { full_name: { 'ui:widget': 'text' } },
    roles: roles ?? ['admin', 'participant'],
  });
  const published = await publishVersionFixture(request, token, form.id, versionId, 'qa publish');
  return {
    formId: form.id,
    formKey: form.key,
    versionId: published.versionId,
    versionNumber: published.versionNumber,
  };
}

export async function deleteFormIfExists(
  request: APIRequestContext,
  token: string | null,
  formId: string | null,
): Promise<void> {
  if (!token || !formId) return;
  await apiRequest(request, 'DELETE', `/api/forms/${formId}`, { token }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Distribution + invitation fixtures
// ---------------------------------------------------------------------------

export type DistributionFixture = {
  id: string;
  publicSlug: string | null;
  mode: 'open' | 'personal';
};

export type CreateDistributionInput = {
  mode?: 'open' | 'personal';
  defaultLocale?: string;
  title?: string | null;
  pinnedVersionId?: string | null;
  requireCustomerAuth?: boolean;
  allowMultipleSubmissions?: boolean;
  maxResponses?: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
  redirectUrl?: string | null;
  settings?: JsonRecord | null;
};

/**
 * `POST /api/forms/:id/distributions` answers `{ id }` only — the minted
 * `publicSlug` is only visible on the detail read, so this always re-reads.
 */
export async function createDistributionFixture(
  request: APIRequestContext,
  token: string,
  formId: string,
  input: CreateDistributionInput = {},
): Promise<DistributionFixture> {
  const data: JsonRecord = {
    mode: input.mode ?? 'open',
    defaultLocale: input.defaultLocale ?? 'en',
  };
  for (const key of [
    'title',
    'pinnedVersionId',
    'requireCustomerAuth',
    'allowMultipleSubmissions',
    'maxResponses',
    'opensAt',
    'closesAt',
    'redirectUrl',
    'settings',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  const response = await apiRequest(request, 'POST', `/api/forms/${formId}/distributions`, { token, data });
  const created = await readJsonSafe<{ id?: string }>(response);
  expect(
    response.status(),
    `distribution create should return 201 (got ${response.status()}: ${JSON.stringify(created)})`,
  ).toBe(201);
  const id = created!.id as string;
  const detail = await readDistribution(request, token, id);
  return {
    id,
    publicSlug: (detail?.publicSlug as string | null) ?? null,
    mode: (detail?.mode as 'open' | 'personal') ?? (input.mode ?? 'open'),
  };
}

export async function readDistribution(
  request: APIRequestContext,
  token: string,
  distributionId: string,
): Promise<JsonRecord | null> {
  const response = await apiRequest(request, 'GET', `/api/forms/distributions/${distributionId}`, { token });
  if (!response.ok()) return null;
  return readJsonSafe<JsonRecord>(response);
}

export async function patchDistribution(
  request: APIRequestContext,
  token: string,
  distributionId: string,
  data: JsonRecord,
) {
  return apiRequest(request, 'PATCH', `/api/forms/distributions/${distributionId}`, { token, data });
}

export async function deleteDistributionIfExists(
  request: APIRequestContext,
  token: string | null,
  distributionId: string | null,
): Promise<void> {
  if (!token || !distributionId) return;
  await patchDistribution(request, token, distributionId, { status: 'closed' }).catch(() => undefined);
}

export type InvitationFixture = { id: string; rawToken: string | null };

export type InvitationRecipient = {
  email?: string;
  name?: string;
  ref?: string;
  role?: string;
  locale?: string;
  expiresAt?: string;
};

/** `rawToken` is returned exactly once — capture it here or lose it. */
export async function createInvitationsFixture(
  request: APIRequestContext,
  token: string,
  distributionId: string,
  recipients: InvitationRecipient[],
): Promise<InvitationFixture[]> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/forms/distributions/${distributionId}/invitations`,
    { token, data: { recipients } },
  );
  const body = await readJsonSafe<{ invitations?: InvitationFixture[] }>(response);
  expect(
    response.status(),
    `invitation create should return 201 (got ${response.status()}: ${JSON.stringify(body)})`,
  ).toBe(201);
  expect(Array.isArray(body?.invitations), 'invitation create should return an invitations array').toBe(true);
  return body!.invitations as InvitationFixture[];
}

export async function listInvitations(
  request: APIRequestContext,
  token: string,
  distributionId: string,
): Promise<{ items: JsonRecord[]; total: number } | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/forms/distributions/${distributionId}/invitations`,
    { token },
  );
  if (!response.ok()) return null;
  return readJsonSafe<{ items: JsonRecord[]; total: number }>(response);
}

export async function revokeInvitationIfExists(
  request: APIRequestContext,
  token: string | null,
  distributionId: string | null,
  invitationId: string | null,
): Promise<void> {
  if (!token || !distributionId || !invitationId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/forms/distributions/${distributionId}/invitations/${invitationId}`,
    { token },
  ).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Public runtime
// ---------------------------------------------------------------------------

export type PublicStartResult = {
  status: number;
  submissionId: string;
  revisionId: string;
  accessToken: string;
  body: JsonRecord;
};

/**
 * `POST /api/forms/public/start` with no ambient credentials.
 *
 * The caller passes its own isolated `APIRequestContext` (see
 * `withCredentialIsolatedRequest`) so the `request` fixture's cookie jar cannot
 * silently authorize the call, and its own `x-forwarded-for` so the public
 * limiter bucket is not shared with the next spec.
 */
export async function startPublicSubmission(
  request: APIRequestContext,
  input: { slug?: string; token?: string; locale?: string; captchaToken?: string; clientIp?: string },
): Promise<PublicStartResult> {
  const data: JsonRecord = {};
  if (input.slug) data.slug = input.slug;
  if (input.token) data.token = input.token;
  if (input.locale) data.locale = input.locale;
  if (input.captchaToken) data.captchaToken = input.captchaToken;

  const response = await request.fetch(resolveUrl('/api/forms/public/start'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': input.clientIp ?? uniqueClientIp(),
    },
    data,
  });
  const body = (await readJsonSafe<JsonRecord>(response)) ?? {};
  const submission = (body.submission as JsonRecord | undefined) ?? {};
  const revision = (body.revision as JsonRecord | undefined) ?? {};
  return {
    status: response.status(),
    submissionId: (submission.id as string) ?? '',
    revisionId: (revision.id as string) ?? '',
    accessToken: (body.access_token as string) ?? '',
    body,
  };
}

/** Asserts the start succeeded and returns it — the happy-path shorthand. */
export async function startPublicSubmissionOrThrow(
  request: APIRequestContext,
  input: { slug?: string; token?: string; locale?: string; clientIp?: string },
): Promise<PublicStartResult> {
  const result = await startPublicSubmission(request, input);
  expect(
    result.status,
    `public start should return 201 (got ${result.status}: ${JSON.stringify(result.body)})`,
  ).toBe(201);
  expect(result.submissionId, 'public start should return a submission id').toBeTruthy();
  expect(result.revisionId, 'public start should return a revision id').toBeTruthy();
  expect(result.accessToken, 'public start should mint an access token').toBeTruthy();
  return result;
}

/** Autosave through the public route with a submission access token. */
export async function publicAutosave(
  request: APIRequestContext,
  input: {
    submissionId: string;
    accessToken?: string | null;
    baseRevisionId: string;
    patch: JsonRecord;
    changeSummary?: string;
    clientIp?: string;
    headers?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': input.clientIp ?? uniqueClientIp(),
    ...(input.headers ?? {}),
  };
  if (input.accessToken) headers.Authorization = `Bearer ${input.accessToken}`;
  const data: JsonRecord = { base_revision_id: input.baseRevisionId, patch: input.patch };
  if (input.changeSummary) data.change_summary = input.changeSummary;
  return request.fetch(resolveUrl(`/api/forms/public/submissions/${input.submissionId}`), {
    method: 'PATCH',
    headers,
    data,
  });
}

/** Final submit through the public route with a submission access token. */
export async function publicSubmit(
  request: APIRequestContext,
  input: {
    submissionId: string;
    accessToken?: string | null;
    baseRevisionId: string;
    clientIp?: string;
    headers?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': input.clientIp ?? uniqueClientIp(),
    ...(input.headers ?? {}),
  };
  if (input.accessToken) headers.Authorization = `Bearer ${input.accessToken}`;
  return request.fetch(resolveUrl(`/api/forms/public/submissions/${input.submissionId}/submit`), {
    method: 'POST',
    headers,
    data: { base_revision_id: input.baseRevisionId },
  });
}

/** Reads the public submission view (resume) with an access token. */
export async function publicRead(
  request: APIRequestContext,
  input: { submissionId: string; accessToken?: string | null; headers?: Record<string, string> },
) {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (input.accessToken) headers.Authorization = `Bearer ${input.accessToken}`;
  return request.fetch(resolveUrl(`/api/forms/public/submissions/${input.submissionId}`), {
    method: 'GET',
    headers,
  });
}

/** Multipart attachment upload on the public route. */
export async function publicUploadAttachment(
  request: APIRequestContext,
  input: {
    submissionId: string;
    accessToken?: string | null;
    fieldKey: string;
    filename: string;
    contentType: string;
    bytes: Buffer;
    headers?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (input.accessToken) headers.Authorization = `Bearer ${input.accessToken}`;
  return request.fetch(resolveUrl(`/api/forms/public/submissions/${input.submissionId}/attachments`), {
    method: 'POST',
    headers,
    multipart: {
      field_key: input.fieldKey,
      file: { name: input.filename, mimeType: input.contentType, buffer: input.bytes },
    },
  });
}

/**
 * Convenience composite: published open-mode form + distribution + a started
 * anonymous submission, all fixtures returned for cleanup. The caller supplies
 * the isolated request context the public calls must run on.
 */
export type AnonymousRunFixture = PublishedFormFixture & {
  distributionId: string;
  publicSlug: string;
  submissionId: string;
  revisionId: string;
  accessToken: string;
  clientIp: string;
};

export async function createAnonymousRunFixture(
  request: APIRequestContext,
  publicRequest: APIRequestContext,
  token: string,
  options: { schema?: JsonRecord; distribution?: CreateDistributionInput } = {},
): Promise<AnonymousRunFixture> {
  const published = await createPublishedFormFixture(request, token, { schema: options.schema });
  const distribution = await createDistributionFixture(request, token, published.formId, {
    mode: 'open',
    ...(options.distribution ?? {}),
  });
  expect(distribution.publicSlug, 'an open distribution must mint a public slug').toBeTruthy();
  const clientIp = uniqueClientIp();
  const started = await startPublicSubmissionOrThrow(publicRequest, {
    slug: distribution.publicSlug as string,
    clientIp,
  });
  return {
    ...published,
    distributionId: distribution.id,
    publicSlug: distribution.publicSlug as string,
    submissionId: started.submissionId,
    revisionId: started.revisionId,
    accessToken: started.accessToken,
    clientIp,
  };
}

/**
 * Calls a portal-authenticated forms route.
 *
 * These routes are `requireAuth: false` at the platform layer and read the
 * customer identity from the portal cookies, so they must NOT go through
 * `apiRequest` (which would attach a staff `Authorization: Bearer`). Pass
 * `portalCookieHeaders(session)` as `cookies`.
 */
export async function portalCall(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { cookies: Record<string, string>; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...options.cookies },
    data: options.data,
  });
}

// ---------------------------------------------------------------------------
// Admin submission reads
// ---------------------------------------------------------------------------

export async function readSubmissionDetail(
  request: APIRequestContext,
  token: string,
  submissionId: string,
) {
  return apiRequest(request, 'GET', `/api/forms/submissions/${submissionId}`, { token });
}

export async function readSubmissionRevisions(
  request: APIRequestContext,
  token: string,
  submissionId: string,
) {
  return apiRequest(request, 'GET', `/api/forms/submissions/${submissionId}/revisions`, { token });
}

export async function readAccessAudit(
  request: APIRequestContext,
  token: string,
  submissionId: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/forms/submissions/${submissionId}/access-audit`,
    { token },
  );
  if (!response.ok()) return [];
  const body = await readJsonSafe<{ items?: JsonRecord[] }>(response);
  return body?.items ?? [];
}

export async function listFormSubmissions(
  request: APIRequestContext,
  token: string,
  formId: string,
  query: Record<string, string | number> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(request, 'GET', `/api/forms/${formId}/submissions${suffix}`, { token });
}
