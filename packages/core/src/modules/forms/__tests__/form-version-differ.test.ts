import type { CompiledFormVersion, FieldDescriptor } from '../services/form-version-compiler'
import { FormVersionDiffer } from '../services/form-version-differ'

function compiled(fields: Record<string, FieldDescriptor>): CompiledFormVersion {
  return {
    schemaHash: 'hash',
    ajv: (() => true) as unknown as CompiledFormVersion['ajv'],
    zod: { _def: {} } as unknown as CompiledFormVersion['zod'],
    fieldIndex: fields,
    rolePolicyLookup: () => ({ canRead: true, canWrite: true }),
    registryVersion: '1',
  }
}

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    key: 'k',
    type: 'text',
    sectionKey: null,
    sensitive: false,
    editableBy: ['admin'],
    visibleTo: ['admin'],
    required: false,
    ...overrides,
  }
}

describe('FormVersionDiffer', () => {
  const differ = new FormVersionDiffer()

  it('classifies added fields and sorts them by section then key', () => {
    const older = compiled({})
    const newer = compiled({
      b_field: descriptor({ key: 'b_field', sectionKey: 'b' }),
      a_field: descriptor({ key: 'a_field', sectionKey: 'a' }),
    })
    const diff = differ.diff(older, newer)
    expect(diff.map((entry) => ({ kind: entry.kind, key: entry.key }))).toEqual([
      { kind: 'added', key: 'a_field' },
      { kind: 'added', key: 'b_field' },
    ])
  })

  it('classifies removed fields', () => {
    const older = compiled({
      foo: descriptor({ key: 'foo' }),
    })
    const newer = compiled({})
    const diff = differ.diff(older, newer)
    expect(diff).toHaveLength(1)
    expect(diff[0].kind).toBe('removed')
    expect(diff[0].key).toBe('foo')
  })

  it('classifies modified fields with deep-path change list', () => {
    const older = compiled({
      foo: descriptor({ key: 'foo', required: false, visibleTo: ['admin'] }),
    })
    const newer = compiled({
      foo: descriptor({ key: 'foo', required: true, visibleTo: ['admin', 'patient'] }),
    })
    const diff = differ.diff(older, newer)
    expect(diff).toHaveLength(1)
    if (diff[0].kind !== 'modified') throw new Error('expected modified')
    expect(diff[0].key).toBe('foo')
    const paths = diff[0].changes.map((entry) => entry.path).sort()
    expect(paths).toEqual(['required', 'visibleTo'])
  })

  it('produces empty diff for identical compiled versions', () => {
    const older = compiled({ x: descriptor({ key: 'x' }) })
    const newer = compiled({ x: descriptor({ key: 'x' }) })
    expect(differ.diff(older, newer)).toEqual([])
  })

  it('returns added then removed then modified', () => {
    const older = compiled({
      kept: descriptor({ key: 'kept', required: false }),
      removed: descriptor({ key: 'removed' }),
    })
    const newer = compiled({
      added: descriptor({ key: 'added' }),
      kept: descriptor({ key: 'kept', required: true }),
    })
    const diff = differ.diff(older, newer)
    const order = diff.map((entry) => `${entry.kind}:${entry.key}`)
    expect(order).toEqual(['added:added', 'removed:removed', 'modified:kept'])
  })
})
