import type { Module } from '@open-mercato/shared/modules/registry'
import type { UpgradeActionDefinition } from '@open-mercato/shared/modules/upgrade-actions'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  collectModuleUpgradeActions,
  createUpgradeActionCatalog,
  isUpgradeActionAvailable,
  resolveUpgradeActionScope,
  validateModuleUpgradeAction,
} from '../upgrade-action-catalog'

function action(overrides: Partial<UpgradeActionDefinition> = {}): UpgradeActionDefinition {
  return {
    id: 'shop.seed',
    version: '1.0.0',
    messageKey: 'shop.upgrades.seed.message',
    ctaKey: 'shop.upgrades.seed.cta',
    successKey: 'shop.upgrades.seed.success',
    run: async () => {},
    ...overrides,
  }
}

function resetRegistry(): void {
  const scope = globalThis as Record<string, unknown>
  delete scope.__openMercatoModulesRegistry__
  delete scope.__openMercatoModulesRegistrySnapshot__
}

describe('validateModuleUpgradeAction', () => {
  it('accepts a well-formed owner-prefixed descriptor', () => {
    expect(validateModuleUpgradeAction('shop', action())).toBeNull()
  })

  it.each([
    ['an id owned by another module', action({ id: 'other.seed' }), 'id must be prefixed with "shop."'],
    ['a bare owner prefix', action({ id: 'shop.' }), 'id must be prefixed with "shop."'],
    ['an invalid version', action({ version: 'next' }), 'invalid version'],
    ['a missing translation key', action({ ctaKey: '' }), 'missing translation keys'],
    ['an unknown scope', action({ scope: 'global' as never }), 'invalid scope'],
    ['a missing run handler', action({ run: undefined as never }), 'missing run handler'],
    ['a non-function down', action({ down: 'nope' as never }), 'invalid down handler'],
    ['a tenant-wide down', action({ scope: 'tenant', down: async () => {} }), 'tenant-wide actions cannot declare down'],
    ['malformed required modules', action({ requiredModules: [''] }), 'invalid requiredModules'],
  ])('rejects %s', (_label, candidate, reason) => {
    expect(validateModuleUpgradeAction('shop', candidate)).toBe(reason)
  })
})

describe('collectModuleUpgradeActions', () => {
  it('binds each valid action to its declaring module and reports invalid ones', () => {
    const valid = action()
    const result = collectModuleUpgradeActions([
      { id: 'shop', upgradeActions: [valid, action({ id: 'other.seed' })] },
      { id: 'bare' },
    ])
    expect(result.actions).toEqual([{ moduleId: 'shop', action: valid }])
    expect(result.issues).toEqual([{ moduleId: 'shop', actionId: 'other.seed', reason: 'id must be prefixed with "shop."' }])
  })

  it('excludes every copy of an id declared more than once, at any version', () => {
    const result = collectModuleUpgradeActions([
      { id: 'shop', upgradeActions: [action(), action({ version: '2.0.0' })] },
    ])
    expect(result.actions).toEqual([])
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'id is declared more than once',
      'id is declared more than once',
    ])
  })

  it('reports a manifest that is not an array', () => {
    const result = collectModuleUpgradeActions([{ id: 'shop', upgradeActions: {} as never }])
    expect(result.issues).toEqual([{ moduleId: 'shop', actionId: null, reason: 'upgradeActions is not an array' }])
  })
})

describe('createUpgradeActionCatalog', () => {
  beforeEach(() => resetRegistry())
  afterAll(() => resetRegistry())

  it('exposes only manual entries before bootstrap and never imports manifests', () => {
    const legacy = action({ id: 'legacy.seed' })
    const target = [legacy]
    const catalog = createUpgradeActionCatalog(target)
    expect(catalog.list()).toEqual([legacy])
    expect(catalog.ownerOf(legacy)).toBeNull()
  })

  it('adds discovered actions to the exported array and records their owner', () => {
    const legacy = action({ id: 'legacy.seed' })
    const discovered = action()
    const target = [legacy]
    const catalog = createUpgradeActionCatalog(target)
    registerModules([{ id: 'shop', upgradeActions: [discovered] }])
    expect(target).toEqual([legacy, discovered])
    expect(catalog.ownerOf(discovered)).toBe('shop')
    expect(catalog.ownerOf(legacy)).toBeNull()
  })

  it('replaces discovered actions on full registry replacement and keeps manual entries', () => {
    const legacy = action({ id: 'legacy.seed' })
    const first = action()
    const second = action({ id: 'crm.seed' })
    const target = [legacy]
    createUpgradeActionCatalog(target)
    registerModules([{ id: 'shop', upgradeActions: [first] }])
    registerModules([{ id: 'crm', upgradeActions: [second] }])
    expect(target).toEqual([legacy, second])
  })

  it('keeps discovered actions through a translation-only registration', () => {
    const discovered = action()
    const target: UpgradeActionDefinition[] = []
    const catalog = createUpgradeActionCatalog(target)
    registerModules([{ id: 'shop', upgradeActions: [discovered] }])
    registerModules([{ id: 'shop', translations: { en: { 'shop.title': 'Shop' } } }])
    expect(catalog.list()).toEqual([discovered])
    expect(catalog.ownerOf(discovered)).toBe('shop')
  })

  it('fills the exported array on creation when modules were registered first', () => {
    const discovered = action()
    registerModules([{ id: 'shop', upgradeActions: [discovered] }] as Module[])
    const target: UpgradeActionDefinition[] = []
    createUpgradeActionCatalog(target)
    expect(target).toEqual([discovered])
  })

  it('keeps the module-owned action when a legacy entry reuses its completion key', () => {
    const discovered = action()
    const target = [action()]
    const catalog = createUpgradeActionCatalog(target)
    registerModules([{ id: 'shop', upgradeActions: [discovered] }])
    expect(catalog.list()).toEqual([discovered])
  })

  it('hides every legacy registration that shares a completion key', () => {
    const target = [action({ id: 'legacy.seed' }), action({ id: 'legacy.seed' })]
    expect(createUpgradeActionCatalog(target).list()).toEqual([])
  })

  it('keeps a legacy id repeated at different versions', () => {
    const target = [action({ id: 'legacy.seed' }), action({ id: 'legacy.seed', version: '2.0.0' })]
    expect(createUpgradeActionCatalog(target).list()).toHaveLength(2)
  })
})

describe('isUpgradeActionAvailable', () => {
  beforeEach(() => resetRegistry())
  afterAll(() => resetRegistry())

  it('requires the owner and every declared peer to be enabled', () => {
    registerModules([{ id: 'shop' }, { id: 'entities' }])
    expect(isUpgradeActionAvailable(action({ requiredModules: ['entities'] }), 'shop')).toBe(true)
    expect(isUpgradeActionAvailable(action({ requiredModules: ['catalog'] }), 'shop')).toBe(false)
    expect(isUpgradeActionAvailable(action(), 'crm')).toBe(false)
  })

  it('fails closed for an action with requirements before bootstrap', () => {
    expect(isUpgradeActionAvailable(action(), 'shop')).toBe(false)
  })

  it('keeps an ownerless action with no requirements available', () => {
    expect(isUpgradeActionAvailable(action(), null)).toBe(true)
  })
})

describe('resolveUpgradeActionScope', () => {
  it('defaults to organization scope', () => {
    expect(resolveUpgradeActionScope(action())).toBe('organization')
    expect(resolveUpgradeActionScope(action({ scope: 'tenant' }))).toBe('tenant')
  })
})
