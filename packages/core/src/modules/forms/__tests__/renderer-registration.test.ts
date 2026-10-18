import { defaultFieldTypeRegistry, FieldTypeRegistry } from '../schema/field-type-registry'
import { CORE_RENDERER_MAP, registerCoreRenderers } from '../ui/public/renderers'
import { mergeOnConflict } from '../ui/public/state/useAutosave'

describe('FormRunner renderer registration', () => {
  it('exposes a renderer for each of the 11 v1 core types', () => {
    const expected = [
      'text',
      'textarea',
      'number',
      'integer',
      'boolean',
      'date',
      'datetime',
      'select_one',
      'select_many',
      'scale',
      'info_block',
    ]
    for (const key of expected) {
      expect(CORE_RENDERER_MAP[key]).toBeDefined()
    }
  })

  it('registers all 11 renderers on a fresh registry', () => {
    const registry = new FieldTypeRegistry()
    for (const key of Object.keys(CORE_RENDERER_MAP)) {
      registry.register(key, {
        validator: () => true,
        renderer: null,
        defaultUiSchema: {},
        exportAdapter: () => '',
      })
    }
    registerCoreRenderers(registry)
    for (const key of Object.keys(CORE_RENDERER_MAP)) {
      expect(registry.get(key)?.renderer).not.toBeNull()
    }
  })

  it('attaches renderers to the default singleton without changing registry version', () => {
    const before = defaultFieldTypeRegistry.getRegistryVersion()
    registerCoreRenderers()
    const after = defaultFieldTypeRegistry.getRegistryVersion()
    expect(after).toBe(before)
    for (const key of Object.keys(CORE_RENDERER_MAP)) {
      expect(defaultFieldTypeRegistry.get(key)?.renderer).not.toBeNull()
    }
  })
})

describe('mergeOnConflict', () => {
  it('keeps local edits when remote did not touch the field', () => {
    const merged = mergeOnConflict({
      localDirty: { name: 'Alice' },
      baseSnapshot: { name: 'Bob' },
      serverFresh: { name: 'Bob' },
    })
    expect(merged.merged).toEqual({ name: 'Alice' })
    expect(merged.conflictingKeys).toEqual([])
  })

  it('reports conflicts when remote and local both diverged from base', () => {
    const merged = mergeOnConflict({
      localDirty: { name: 'Alice' },
      baseSnapshot: { name: 'Bob' },
      serverFresh: { name: 'Carol' },
    })
    expect(merged.merged).toEqual({ name: 'Alice' })
    expect(merged.conflictingKeys).toEqual(['name'])
  })

  it('preserves server-only fields untouched by local edits', () => {
    const merged = mergeOnConflict({
      localDirty: { name: 'Alice' },
      baseSnapshot: { name: 'Bob', age: 30 },
      serverFresh: { name: 'Bob', age: 31 },
    })
    expect(merged.merged.age).toBe(31)
  })
})
