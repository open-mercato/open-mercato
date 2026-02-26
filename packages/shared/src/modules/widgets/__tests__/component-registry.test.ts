import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { z } from 'zod'
import type {
  ComponentRegistryEntry,
  ReplaceOverride,
  WrapperOverride,
  PropsTransformOverride,
} from '@open-mercato/shared/modules/widgets/component-registry'

type RegistryModule = typeof import('@open-mercato/shared/modules/widgets/component-registry')

const MockComponent = (() => null) as unknown as ComponentType<Record<string, unknown>>
const MockComponent2 = (() => null) as unknown as ComponentType<Record<string, unknown>>
const MockLazy = (() => null) as unknown as LazyExoticComponent<ComponentType<Record<string, unknown>>>
const mockSchema = {} as z.ZodType

function makeEntry(id: string, module = 'test-module'): ComponentRegistryEntry {
  return {
    id,
    component: MockComponent,
    metadata: {
      module,
      description: `Component ${id}`,
    },
  }
}

function makeReplaceOverride(componentId: string, priority: number): ReplaceOverride {
  return {
    target: { componentId },
    priority,
    replacement: MockLazy,
    propsSchema: mockSchema,
  }
}

function makeWrapperOverride(componentId: string, priority: number): WrapperOverride {
  return {
    target: { componentId },
    priority,
    wrapper: (Original) => Original,
  }
}

function makePropsTransformOverride(componentId: string, priority: number): PropsTransformOverride {
  return {
    target: { componentId },
    priority,
    propsTransform: (props) => props,
  }
}

describe('Component Registry', () => {
  const originalEnv = process.env.NODE_ENV
  let registry: RegistryModule

  beforeEach(() => {
    delete (globalThis as any).__openMercatoComponentRegistry__
    delete (globalThis as any).__openMercatoComponentOverrides__
    process.env.NODE_ENV = originalEnv
    jest.resetModules()
    registry = require('@open-mercato/shared/modules/widgets/component-registry') as RegistryModule
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  describe('registerComponent', () => {
    it('stores a component and it is retrievable via getRegisteredComponent', () => {
      const entry = makeEntry('widgets.header')

      registry.registerComponent(entry)

      const result = registry.getRegisteredComponent('widgets.header')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('widgets.header')
      expect(result!.component).toBe(MockComponent)
      expect(result!.metadata.module).toBe('test-module')
      expect(result!.metadata.description).toBe('Component widgets.header')
    })

    it('re-registers a component with the same ID, replacing the previous entry', () => {
      const original = makeEntry('widgets.sidebar', 'module-a')
      const replacement: ComponentRegistryEntry = {
        id: 'widgets.sidebar',
        component: MockComponent2,
        metadata: {
          module: 'module-b',
          description: 'Replaced sidebar',
        },
      }

      registry.registerComponent(original)
      process.env.NODE_ENV = 'development'
      registry.registerComponent(replacement)

      const result = registry.getRegisteredComponent('widgets.sidebar')
      expect(result).not.toBeNull()
      expect(result!.component).toBe(MockComponent2)
      expect(result!.metadata.module).toBe('module-b')
      expect(result!.metadata.description).toBe('Replaced sidebar')

      const all = registry.getAllRegisteredComponents()
      const matchCount = all.filter((e) => e.id === 'widgets.sidebar').length
      expect(matchCount).toBe(1)
    })
  })

  describe('getRegisteredComponent', () => {
    it('returns null for unknown component IDs', () => {
      registry.registerComponent(makeEntry('widgets.header'))

      const result = registry.getRegisteredComponent('nonexistent.component')
      expect(result).toBeNull()
    })

    it('returns null when registry is empty', () => {
      const result = registry.getRegisteredComponent('any.id')
      expect(result).toBeNull()
    })
  })

  describe('registerComponentOverrides', () => {
    it('stores overrides sorted by priority ascending', () => {
      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 30)],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.header', 10)],
        },
        {
          moduleId: 'module-c',
          overrides: [makeReplaceOverride('widgets.header', 20)],
        },
      ])

      const all = registry.getAllOverrides()
      expect(all).toHaveLength(3)
      expect(all[0].override.priority).toBe(10)
      expect(all[0].moduleId).toBe('module-b')
      expect(all[1].override.priority).toBe(20)
      expect(all[1].moduleId).toBe('module-c')
      expect(all[2].override.priority).toBe(30)
      expect(all[2].moduleId).toBe('module-a')
    })

    it('flattens multiple overrides from a single module', () => {
      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [
            makeWrapperOverride('widgets.header', 10),
            makePropsTransformOverride('widgets.footer', 20),
          ],
        },
      ])

      const all = registry.getAllOverrides()
      expect(all).toHaveLength(2)
      expect(all[0].moduleId).toBe('module-a')
      expect(all[1].moduleId).toBe('module-a')
    })
  })

  describe('getOverridesForComponent', () => {
    it('filters overrides by target componentId', () => {
      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 10)],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.footer', 20)],
        },
        {
          moduleId: 'module-c',
          overrides: [makeReplaceOverride('widgets.header', 30)],
        },
      ])

      const headerOverrides = registry.getOverridesForComponent('widgets.header')
      expect(headerOverrides).toHaveLength(2)
      expect(headerOverrides[0].moduleId).toBe('module-a')
      expect(headerOverrides[1].moduleId).toBe('module-c')

      const footerOverrides = registry.getOverridesForComponent('widgets.footer')
      expect(footerOverrides).toHaveLength(1)
      expect(footerOverrides[0].moduleId).toBe('module-b')
    })

    it('returns empty array when no overrides target the component', () => {
      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 10)],
        },
      ])

      const result = registry.getOverridesForComponent('widgets.nonexistent')
      expect(result).toEqual([])
    })

    it('returns empty array when no overrides are registered', () => {
      const result = registry.getOverridesForComponent('widgets.header')
      expect(result).toEqual([])
    })
  })

  describe('type guards', () => {
    it('isReplaceOverride identifies replace overrides correctly', () => {
      const replace = makeReplaceOverride('x', 1)
      const wrapper = makeWrapperOverride('x', 1)
      const propsTransform = makePropsTransformOverride('x', 1)

      expect(registry.isReplaceOverride(replace)).toBe(true)
      expect(registry.isReplaceOverride(wrapper)).toBe(false)
      expect(registry.isReplaceOverride(propsTransform)).toBe(false)
    })

    it('isWrapperOverride identifies wrapper overrides correctly', () => {
      const replace = makeReplaceOverride('x', 1)
      const wrapper = makeWrapperOverride('x', 1)
      const propsTransform = makePropsTransformOverride('x', 1)

      expect(registry.isWrapperOverride(replace)).toBe(false)
      expect(registry.isWrapperOverride(wrapper)).toBe(true)
      expect(registry.isWrapperOverride(propsTransform)).toBe(false)
    })

    it('isPropsTransformOverride identifies propsTransform overrides correctly', () => {
      const replace = makeReplaceOverride('x', 1)
      const wrapper = makeWrapperOverride('x', 1)
      const propsTransform = makePropsTransformOverride('x', 1)

      expect(registry.isPropsTransformOverride(replace)).toBe(false)
      expect(registry.isPropsTransformOverride(wrapper)).toBe(false)
      expect(registry.isPropsTransformOverride(propsTransform)).toBe(true)
    })
  })

  describe('priority collision warning', () => {
    it('logs a warning when overrides have same priority on same target in dev mode', () => {
      process.env.NODE_ENV = 'development'
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 10)],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.header', 10)],
        },
      ])

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('same priority (10)'),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"widgets.header"'),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('module-a'),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('module-b'),
      )

      warnSpy.mockRestore()
    })

    it('does not log a warning when overrides have different priorities', () => {
      process.env.NODE_ENV = 'development'
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 10)],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.header', 20)],
        },
      ])

      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('does not log a warning when same priority targets different components', () => {
      process.env.NODE_ENV = 'development'
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [makeWrapperOverride('widgets.header', 10)],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.footer', 10)],
        },
      ])

      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })
  })

  describe('getAllRegisteredComponents', () => {
    it('returns all registered components', () => {
      registry.registerComponent(makeEntry('widgets.header'))
      registry.registerComponent(makeEntry('widgets.footer'))
      registry.registerComponent(makeEntry('widgets.sidebar'))

      const all = registry.getAllRegisteredComponents()
      expect(all).toHaveLength(3)
      const ids = all.map((e) => e.id)
      expect(ids).toContain('widgets.header')
      expect(ids).toContain('widgets.footer')
      expect(ids).toContain('widgets.sidebar')
    })

    it('returns empty array when no components are registered', () => {
      const all = registry.getAllRegisteredComponents()
      expect(all).toEqual([])
    })
  })

  describe('getAllOverrides', () => {
    it('returns all registered overrides', () => {
      registry.registerComponentOverrides([
        {
          moduleId: 'module-a',
          overrides: [
            makeWrapperOverride('widgets.header', 10),
            makeReplaceOverride('widgets.footer', 20),
          ],
        },
        {
          moduleId: 'module-b',
          overrides: [makePropsTransformOverride('widgets.sidebar', 15)],
        },
      ])

      const all = registry.getAllOverrides()
      expect(all).toHaveLength(3)
      expect(all[0].override.priority).toBe(10)
      expect(all[1].override.priority).toBe(15)
      expect(all[2].override.priority).toBe(20)
    })

    it('returns empty array when no overrides are registered', () => {
      const all = registry.getAllOverrides()
      expect(all).toEqual([])
    })
  })
})
