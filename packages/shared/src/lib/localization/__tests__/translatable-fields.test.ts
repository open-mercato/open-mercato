import {
  registerTranslatableFields,
  getTranslatableFields,
  getTranslatableFieldsRegistry,
} from '../translatable-fields'

// The registry is global mutable state — we snapshot before all tests
// and restore it in afterAll to avoid leaking into other suites.
let originalSnapshot: Record<string, string[]>

beforeAll(() => {
  originalSnapshot = getTranslatableFieldsRegistry()
})

afterAll(() => {
  // Restore by registering original snapshot (overwrites test state)
  registerTranslatableFields(originalSnapshot)
})

describe('translatable fields registry', () => {

  it('returns undefined for unregistered entity type', () => {
    expect(getTranslatableFields('unknown:entity')).toBeUndefined()
  })

  it('returns registered fields after registration', () => {
    registerTranslatableFields({ 'test:product': ['title', 'description'] })
    expect(getTranslatableFields('test:product')).toEqual(['title', 'description'])
  })

  it('supports multiple entity types', () => {
    registerTranslatableFields({
      'mod:entity_a': ['name'],
      'mod:entity_b': ['label', 'description'],
    })
    expect(getTranslatableFields('mod:entity_a')).toEqual(['name'])
    expect(getTranslatableFields('mod:entity_b')).toEqual(['label', 'description'])
  })

  it('overwrites fields when same entity registered twice', () => {
    registerTranslatableFields({ 'test:item': ['title'] })
    registerTranslatableFields({ 'test:item': ['name', 'label'] })
    expect(getTranslatableFields('test:item')).toEqual(['name', 'label'])
  })

  it('getTranslatableFieldsRegistry returns object containing registered entries', () => {
    registerTranslatableFields({ 'reg_test:alpha': ['x'], 'reg_test:beta': ['y'] })
    const registry = getTranslatableFieldsRegistry()
    expect(registry['reg_test:alpha']).toEqual(['x'])
    expect(registry['reg_test:beta']).toEqual(['y'])
    expect(typeof registry).toBe('object')
  })

  it('mutating the returned registry does not affect internal state', () => {
    registerTranslatableFields({ 'test:safe': ['field1'] })
    const copy = getTranslatableFieldsRegistry()
    copy['test:safe'] = ['hacked']
    copy['test:new'] = ['injected']
    expect(getTranslatableFields('test:safe')).toEqual(['field1'])
    expect(getTranslatableFields('test:new')).toBeUndefined()
  })

  it('merges with existing entries when registering new ones', () => {
    registerTranslatableFields({ 'a:first': ['f1'] })
    registerTranslatableFields({ 'b:second': ['f2'] })
    expect(getTranslatableFields('a:first')).toEqual(['f1'])
    expect(getTranslatableFields('b:second')).toEqual(['f2'])
  })
})
