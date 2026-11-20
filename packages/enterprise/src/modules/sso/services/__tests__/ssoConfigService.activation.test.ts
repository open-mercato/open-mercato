import type { EntityManager } from '@mikro-orm/postgresql'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { SsoConfig } from '../../data/entities'
import type { SsoProviderRegistry } from '../../lib/registry'
import { SsoConfigService } from '../ssoConfigService'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

const mockResolveTranslations = jest.fn()
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async () => [],
}))

const scope = { tenantId: 'tenant', organizationId: 'org', isSuperAdmin: false }

function setup(allowedDomains = ['example.com']) {
  const config = { id: 'config', tenantId: 'tenant', organizationId: 'org', protocol: 'oidc', allowedDomains, isActive: false } as SsoConfig
  const transaction = {
    findOne: jest.fn().mockResolvedValue(config),
    getConnection: () => ({ execute: jest.fn() }),
    flush: jest.fn(),
  }
  const manager = { transactional: async (operation: (entityManager: typeof transaction) => Promise<unknown>) => operation(transaction) }
  const validateConfig = jest.fn().mockResolvedValue({ ok: false, error: 'localized provider reason' })
  const registry = { resolve: () => ({ validateConfig }) }
  const service = new SsoConfigService(
    manager as unknown as EntityManager,
    {} as TenantDataEncryptionService,
    registry as unknown as SsoProviderRegistry,
  )
  return { service, config, transaction, validateConfig }
}

describe('SSO activation refusal translations', () => {
  it.each([
    [en, 'Cannot activate — discovery failed: localized provider reason'],
    [pl, 'Nie można aktywować — wykrywanie nie powiodło się: localized provider reason'],
    [de, 'Aktivierung nicht möglich — Erkennung fehlgeschlagen: localized provider reason'],
    [es, 'No se puede activar — falló el descubrimiento: localized provider reason'],
    [ko, '활성화할 수 없습니다 — 검색 실패: localized provider reason'],
  ] as const)('uses the request locale and preserves the provider reason', async (dictionary, expectedMessage) => {
    mockResolveTranslations.mockResolvedValue({ t: createTranslator(dictionary) })
    const { service, config, transaction } = setup()

    await expect(service.activate(scope, config.id, true)).rejects.toMatchObject({ statusCode: 400, message: expectedMessage })
    expect(config.isActive).toBe(false)
    expect(transaction.flush).not.toHaveBeenCalled()
  })

  it('translates a missing-domain refusal before discovery and leaves the config inactive', async () => {
    mockResolveTranslations.mockResolvedValue({ t: createTranslator(pl) })
    const { service, config, transaction, validateConfig } = setup([])

    await expect(service.activate(scope, config.id, true)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Dodaj co najmniej jedną dozwoloną domenę e-mail przed aktywacją',
    })
    expect(config.isActive).toBe(false)
    expect(validateConfig).not.toHaveBeenCalled()
    expect(transaction.flush).not.toHaveBeenCalled()
  })
})
