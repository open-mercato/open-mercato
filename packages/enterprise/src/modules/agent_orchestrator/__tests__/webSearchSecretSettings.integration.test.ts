import { asValue, createContainer } from 'awilix'
import { z } from 'zod'
import type { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { createModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { decryptWithAesGcm, generateDek, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import {
  CONTRACT_VERSION,
  READY,
  SECRET_PLACEHOLDER,
  createUnavailableAdapter,
  defineAdapterModule,
} from '@open-mercato/web-research'
import { GET, PUT } from '../api/web-search/settings/route'
import { resolveWebSearchSettings } from '../lib/webSearch/policy'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'
const URL = 'http://localhost/api/agent_orchestrator/web-search/settings'
const SECRET = 'fixture-adapter-key'
const ADAPTER = defineAdapterModule({
  id: 'fixture',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: z.object({ apiKey: z.string().min(1) }),
  createAdapter: () => ({
    ...createUnavailableAdapter('fixture', 'fixture'),
    readiness: () => READY,
  }),
})

function makeFixture() {
  const rows: ModuleConfig[] = []
  const deks = new Map([[TENANT, generateDek()], [OTHER_TENANT, generateDek()]])
  const flush = jest.fn(async () => {})
  const container = createContainer() as AppContainer
  container.register({
    em: asValue({
      getRepository: () => ({
        findOne: async (query: Pick<ModuleConfig, 'moduleId' | 'name' | 'tenantId'>) =>
          rows.find((row) => row.moduleId === query.moduleId &&
            row.name === query.name && row.tenantId === query.tenantId) ?? null,
        create: (fields: Omit<ModuleConfig, 'id'>) => ({ id: 'config-fixture', ...fields }),
      }),
      persist: (row: ModuleConfig) => { rows.push(row) },
      flush,
    }),
    tenantEncryptionService: asValue({
      isEnabled: () => true,
      getDek: async (tenantId: string) => ({ key: deks.get(tenantId) }),
      createDek: async () => null,
    }),
    webResearchAdapterEntries: asValue([{ packageName: 'fixture', module: ADAPTER }]),
  })
  container.register({ moduleConfigService: asValue(createModuleConfigService(container)) })
  jest.mocked(createRequestContainer).mockResolvedValue(container)
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'fixture-user', tenantId: TENANT })

  const storedKey = () => {
    const row = rows.find(({ tenantId }) => tenantId === TENANT)
    return z.object({ adapterOptions: z.object({ fixture: z.object({ apiKey: z.string() }) }) })
      .parse(row?.valueJson).adapterOptions.fixture.apiKey
  }
  return { container, deks, flush, storedKey }
}

function saveSettings(value: unknown) {
  return PUT(new Request(URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  }))
}

describe('web-search secret settings', () => {
  it('seals the tenant row, reads the key for runtime, and masks it in GET and PUT', async () => {
    const { container, deks, storedKey } = makeFixture()
    const write = await saveSettings({ adapterOptions: { fixture: { apiKey: SECRET } } })
    expect(write.status).toBe(200)
    const writeBody: unknown = await write.json()
    expect(writeBody).toMatchObject({
      secretsEncrypted: true,
      installed: [{ id: 'fixture', configured: true, options: { apiKey: SECRET_PLACEHOLDER } }],
    })
    const sealed = storedKey()
    expect(isEncryptedPayloadShape(sealed)).toBe(true)
    expect(JSON.stringify(writeBody)).not.toContain(SECRET)
    expect(JSON.stringify(writeBody)).not.toContain(sealed)
    expect(decryptWithAesGcm(sealed, deks.get(TENANT)!)).toBe(SECRET)
    expect(decryptWithAesGcm(sealed, deks.get(OTHER_TENANT)!)).toBeNull()

    const read = await GET(new Request(URL))
    expect(read.status).toBe(200)
    const readBody: unknown = await read.json()
    expect(readBody).toMatchObject({
      installed: [{ id: 'fixture', configured: true, options: { apiKey: SECRET_PLACEHOLDER } }],
    })
    expect(JSON.stringify(readBody)).not.toContain(SECRET)
    expect(JSON.stringify(readBody)).not.toContain(sealed)
    expect((await resolveWebSearchSettings(container, TENANT)).adapterOptions).toEqual({
      fixture: { apiKey: SECRET },
    })
    expect((await resolveWebSearchSettings(container, OTHER_TENANT)).adapterOptions).toEqual({})

    const unchanged = await saveSettings({ adapterOptions: { fixture: { apiKey: SECRET_PLACEHOLDER } } })
    expect(unchanged.status).toBe(200)
    expect(storedKey()).toBe(sealed)
  })

  it('rejects retaining a stale envelope without a write and accepts an explicit replacement', async () => {
    const { deks, flush, storedKey } = makeFixture()
    expect((await saveSettings({ adapterOptions: { fixture: { apiKey: SECRET } } })).status).toBe(200)
    const sealed = storedKey()
    deks.set(TENANT, generateDek())
    flush.mockClear()

    const echoed = await saveSettings({ adapterOptions: { fixture: { apiKey: SECRET_PLACEHOLDER } } })
    expect(echoed.status).toBe(503)
    expect((await saveSettings({ guardrails: { denyDomains: ['example.test'] } })).status).toBe(503)
    expect(flush).not.toHaveBeenCalled()
    expect(storedKey()).toBe(sealed)

    const replacement = 'replacement-fixture-key'
    expect((await saveSettings({ adapterOptions: { fixture: { apiKey: replacement } } })).status).toBe(200)
    expect(decryptWithAesGcm(storedKey(), deks.get(TENANT)!)).toBe(replacement)
  })
})
