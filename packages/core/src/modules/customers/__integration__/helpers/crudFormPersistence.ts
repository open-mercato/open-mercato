import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  type CrudFormRoundTripConfig,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

const DEFINITIONS_PATH = '/api/entities/definitions';
const TAGS_PATH = '/api/customers/tags';

export function createPersistenceFixtures(request: APIRequestContext, token: string) {
  const suffix = randomUUID().replaceAll('-', '');
  const { organizationId } = getTokenContext(token);
  const deletions: Array<{ path: string; remove: () => Promise<APIResponse> }> = [];

  function trackRecord(path: string, id: string, deleteByBody = false): string {
    deletions.push({
      path,
      remove: () => deleteByBody
        ? apiRequest(request, 'DELETE', path, { token, data: { id } })
        : apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }),
    });
    return id;
  }

  async function dictionaryValue(kind: string, name: string): Promise<string> {
    const path = `/api/customers/dictionaries/${kind}`;
    const value = `${name}-${suffix}`;
    const response = await apiRequestWithSelectedOrg(request, 'POST', path, {
      token,
      selectedOrgId: organizationId,
      data: { value, label: value },
    });
    expect(response.status(), `create ${kind} dictionary value`).toBe(201);
    const entry = await readJsonSafe<{ id: string }>(response);
    const id = expectId(entry?.id, `${kind} dictionary entry must have an ID`);
    const entryPath = `${path}/${encodeURIComponent(id)}`;
    deletions.push({
      path: entryPath,
      remove: () => apiRequestWithSelectedOrg(request, 'DELETE', entryPath, {
        token,
        selectedOrgId: organizationId,
      }),
    });
    return value;
  }

  async function tag(name: string): Promise<string> {
    const slug = `${name}-${suffix}`;
    const response = await apiRequest(request, 'POST', TAGS_PATH, {
      token,
      data: { slug, label: slug },
    });
    expect(response.status(), 'create customer tag').toBe(201);
    const tagRecord = await readJsonSafe<{ id: string }>(response);
    return trackRecord(TAGS_PATH, expectId(tagRecord?.id, 'tag must have an ID'));
  }

  async function customField(
    entityId: string,
    name: string,
    kind: 'text' | 'multiline' | 'boolean' | 'integer' | 'select',
    config: { options?: string[]; multi?: boolean } = {},
  ): Promise<string> {
    const key = `qa_${name}_${suffix}`;
    const response = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
      token,
      data: { entityId, key, kind, configJson: { label: key, ...config } },
    });
    expect(response.status(), `create ${name} custom field`).toBe(200);
    deletions.push({
      path: `${DEFINITIONS_PATH} (${key})`,
      remove: () => apiRequest(request, 'DELETE', DEFINITIONS_PATH, { token, data: { entityId, key } }),
    });
    return key;
  }

  function roundTrip(config: Omit<CrudFormRoundTripConfig, 'request' | 'token' | 'cleanup' | 'idFromCreate'>) {
    return runCrudFormRoundTrip({
      ...config,
      request,
      token,
      cleanup: false,
      idFromCreate: (record) => trackRecord(
        config.collectionPath,
        expectId(record.id ?? record.entityId, 'created customer record must have an ID'),
      ),
    });
  }

  async function cleanup() {
    for (const { path, remove } of deletions.reverse()) {
      try {
        const response = await remove();
        expect.soft(response.ok() || response.status() === 404, `DELETE ${path} returned ${response.status()}`).toBe(true);
      } catch (error) {
        expect.soft(error, `DELETE ${path} failed`).toBeUndefined();
      }
    }
  }

  return { suffix, trackRecord, dictionaryValue, tag, customField, roundTrip, cleanup };
}

export async function readDetail<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<T | null> {
  const response = await apiRequest(request, 'GET', `${path}/${encodeURIComponent(id)}`, { token });
  expect(response.status(), `read back ${path}`).toBe(200);
  return readJsonSafe<T>(response);
}

type ContactDetail = {
  person?: CrudRecord;
  company?: CrudRecord;
  profile?: CrudRecord | null;
  customFields?: CrudRecord;
  tags?: Array<{ id: string }>;
};

export async function readContact(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
  entity: 'person' | 'company',
): Promise<CrudRecord | null> {
  const detail = await readDetail<ContactDetail>(request, token, path, id);
  const record = detail?.[entity];
  if (record?.id !== id || !detail?.profile) return null;
  return {
    ...detail.profile,
    ...record,
    tags: detail.tags?.map((tag) => tag.id).sort(),
    customValues: detail.customFields,
  };
}
