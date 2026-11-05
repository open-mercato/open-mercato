import {
  RESERVED_AI_UI_PART_IDS,
  createAiUiPartRegistry,
  defaultAiUiPartRegistry,
  listAiUiParts,
  registerAiUiPart,
  resetAiUiPartRegistryForTests,
  resolveAiUiPart,
  unregisterAiUiPart,
  type AiUiPartComponent,
} from '../ui-part-registry'
import { PendingPhase3Placeholder } from '../ui-parts/pending-phase3-placeholder'
import { AI_MUTATION_APPROVAL_CARDS } from '../parts/approval-cards-map'
import { MutationPreviewCard } from '../parts/MutationPreviewCard'
import { FieldDiffCard } from '../parts/FieldDiffCard'
import { ConfirmationCard } from '../parts/ConfirmationCard'
import { MutationResultCard } from '../parts/MutationResultCard'

const NullComponent = (() => null) as unknown as AiUiPartComponent

describe('ai-part-registry', () => {
  beforeEach(() => {
    resetAiUiPartRegistryForTests()
  })

  afterAll(() => {
    resetAiUiPartRegistryForTests()
  })

  it('resolves the LIVE mutation-approval cards on the default registry (Step 5.10)', () => {
    expect(resolveAiUiPart('mutation-preview-card')).toBe(MutationPreviewCard)
    expect(resolveAiUiPart('field-diff-card')).toBe(FieldDiffCard)
    expect(resolveAiUiPart('confirmation-card')).toBe(ConfirmationCard)
    expect(resolveAiUiPart('mutation-result-card')).toBe(MutationResultCard)
  })

  it('AI_MUTATION_APPROVAL_CARDS includes every reserved Phase 3 slot id', () => {
    for (const reservedId of RESERVED_AI_UI_PART_IDS) {
      expect(AI_MUTATION_APPROVAL_CARDS[reservedId]).toBeDefined()
    }
  })

  it('round-trips a registered component, overwriting the seeded placeholder', () => {
    registerAiUiPart('mutation-preview-card', NullComponent)
    expect(resolveAiUiPart('mutation-preview-card')).toBe(NullComponent)
  })

  it('unregisterAiUiPart removes a registration (including seeded placeholders)', () => {
    unregisterAiUiPart('field-diff-card')
    expect(resolveAiUiPart('field-diff-card')).toBeNull()
  })

  it('re-registering the same id overwrites the previous entry', () => {
    const first = (() => null) as unknown as AiUiPartComponent
    const second = (() => null) as unknown as AiUiPartComponent
    registerAiUiPart('confirmation-card', first)
    registerAiUiPart('confirmation-card', second)
    expect(resolveAiUiPart('confirmation-card')).toBe(second)
  })

  it('rejects empty component ids', () => {
    expect(() => registerAiUiPart('', NullComponent)).toThrow()
  })

  it('ships with the canonical reserved Phase 3 slot ids', () => {
    expect(RESERVED_AI_UI_PART_IDS).toEqual([
      'mutation-preview-card',
      'field-diff-card',
      'confirmation-card',
      'mutation-result-card',
    ])
  })

  describe('listAiUiParts()', () => {
    it('returns reserved: true for the four Phase 3 slot ids', () => {
      const entries = listAiUiParts()
      const byId = new Map(entries.map((entry) => [entry.componentId, entry]))
      for (const reserved of RESERVED_AI_UI_PART_IDS) {
        expect(byId.get(reserved)).toEqual({ componentId: reserved, reserved: true })
      }
    })

    it('returns reserved: false for user-registered components', () => {
      registerAiUiPart('custom-widget', NullComponent)
      const entries = listAiUiParts()
      const entry = entries.find((e) => e.componentId === 'custom-widget')
      expect(entry).toEqual({ componentId: 'custom-widget', reserved: false })
    })
  })

  describe('defaultAiUiPartRegistry', () => {
    it('exposes the legacy helpers over the same underlying store', () => {
      registerAiUiPart('custom-widget', NullComponent)
      expect(defaultAiUiPartRegistry.has('custom-widget')).toBe(true)
      expect(defaultAiUiPartRegistry.resolve('custom-widget')).toBe(NullComponent)
    })

    it('clear() empties everything and re-seeds the LIVE approval cards on the default registry', () => {
      registerAiUiPart('custom-widget', NullComponent)
      defaultAiUiPartRegistry.clear()
      expect(defaultAiUiPartRegistry.has('custom-widget')).toBe(false)
      expect(defaultAiUiPartRegistry.resolve('mutation-preview-card')).toBe(
        MutationPreviewCard,
      )
    })
  })

  describe('createAiUiPartRegistry()', () => {
    it('seeds reserved placeholders by default (scoped isolation preserved)', () => {
      const registry = createAiUiPartRegistry()
      for (const reserved of RESERVED_AI_UI_PART_IDS) {
        expect(registry.resolve(reserved)).toBe(PendingPhase3Placeholder)
        expect(registry.has(reserved)).toBe(true)
      }
    })

    it('seeds the LIVE approval cards when seedLiveApprovalCards: true', () => {
      const registry = createAiUiPartRegistry({ seedLiveApprovalCards: true })
      expect(registry.resolve('mutation-preview-card')).toBe(MutationPreviewCard)
      expect(registry.resolve('field-diff-card')).toBe(FieldDiffCard)
      expect(registry.resolve('confirmation-card')).toBe(ConfirmationCard)
      expect(registry.resolve('mutation-result-card')).toBe(MutationResultCard)
    })

    it('does NOT seed placeholders when seedReservedPlaceholders is false', () => {
      const registry = createAiUiPartRegistry({ seedReservedPlaceholders: false })
      for (const reserved of RESERVED_AI_UI_PART_IDS) {
        expect(registry.resolve(reserved)).toBeNull()
        expect(registry.has(reserved)).toBe(false)
      }
      expect(registry.list()).toEqual([])
    })

    it('registrations on a scoped registry do not leak into the default registry', () => {
      const scoped = createAiUiPartRegistry()
      scoped.register('scoped-widget', NullComponent)
      expect(scoped.has('scoped-widget')).toBe(true)
      expect(defaultAiUiPartRegistry.has('scoped-widget')).toBe(false)
      expect(resolveAiUiPart('scoped-widget')).toBeNull()
    })

    it('two scoped registries maintain independent state', () => {
      const a = createAiUiPartRegistry()
      const b = createAiUiPartRegistry()
      const first = (() => null) as unknown as AiUiPartComponent
      const second = (() => null) as unknown as AiUiPartComponent
      a.register('mutation-preview-card', first)
      b.register('mutation-preview-card', second)
      expect(a.resolve('mutation-preview-card')).toBe(first)
      expect(b.resolve('mutation-preview-card')).toBe(second)
    })

    it('register() replaces an existing id on a scoped registry', () => {
      const registry = createAiUiPartRegistry()
      const real = (() => null) as unknown as AiUiPartComponent
      registry.register('mutation-preview-card', real)
      expect(registry.resolve('mutation-preview-card')).toBe(real)
    })

    it('unregister() removes an entry on a scoped registry', () => {
      const registry = createAiUiPartRegistry()
      registry.unregister('confirmation-card')
      expect(registry.has('confirmation-card')).toBe(false)
      expect(registry.resolve('confirmation-card')).toBeNull()
    })

    it('clear() wipes registrations and re-seeds reserved ids when seeding is enabled', () => {
      const registry = createAiUiPartRegistry()
      registry.register('custom', NullComponent)
      registry.clear()
      expect(registry.has('custom')).toBe(false)
      for (const reserved of RESERVED_AI_UI_PART_IDS) {
        expect(registry.has(reserved)).toBe(true)
      }
    })

    it('clear() leaves an un-seeded registry empty', () => {
      const registry = createAiUiPartRegistry({ seedReservedPlaceholders: false })
      registry.register('custom', NullComponent)
      registry.clear()
      expect(registry.list()).toEqual([])
    })

    it('list() flags reserved entries correctly on scoped registries', () => {
      const registry = createAiUiPartRegistry()
      registry.register('custom-widget', NullComponent)
      const entries = registry.list()
      const byId = new Map(entries.map((entry) => [entry.componentId, entry]))
      expect(byId.get('custom-widget')).toEqual({
        componentId: 'custom-widget',
        reserved: false,
      })
      expect(byId.get('mutation-preview-card')).toEqual({
        componentId: 'mutation-preview-card',
        reserved: true,
      })
    })
  })
})
