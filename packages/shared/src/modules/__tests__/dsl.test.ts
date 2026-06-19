import { defineLink, entityId, linkable, defineFields, cf } from '../../modules/dsl'
import { CUSTOM_FIELD_KINDS } from '../../modules/entities/kinds'
import type { CustomFieldDefinition, CustomFieldKind } from '../../modules/entities'

describe('DSL helpers', () => {
  test('defineLink + entityId', () => {
    const link = defineLink(entityId('auth','user'), entityId('my_module','user_profile'), {
      join: { baseKey: 'id', extensionKey: 'user_id' },
      cardinality: 'one-to-one',
      required: false,
      description: 'Profile for user',
    })
    expect(link.base).toBe('auth:user')
    expect(link.extension).toBe('my_module:user_profile')
    expect(link.join).toEqual({ baseKey: 'id', extensionKey: 'user_id' })
  })

  test('linkable helper', () => {
    const Auth = { linkable: linkable('auth', ['user','role']) }
    expect(Auth.linkable.user).toBe('auth:user')
    expect(Auth.linkable.role).toBe('auth:role')
  })

  test('defineFields + cf helpers', () => {
    const set = defineFields(entityId('directory','organization'), [
      cf.select('industry', ['SaaS','Retail'], { filterable: true }),
      cf.boolean('vip', { required: false }),
      cf.integer('priority'),
    ], 'my_module')
    expect(set.entity).toBe('directory:organization')
    expect(set.fields[0]).toMatchObject({ key: 'industry', kind: 'select', options: ['SaaS','Retail'], filterable: true })
    expect(set.fields[1]).toMatchObject({ key: 'vip', kind: 'boolean' })
    expect(set.fields[2]).toMatchObject({ key: 'priority', kind: 'integer' })
    expect(set.source).toBe('my_module')
  })

  test('cf.date / cf.datetime helpers produce date kinds (#3042)', () => {
    expect(cf.date('birth_date', { label: 'Birth date' })).toMatchObject({ key: 'birth_date', kind: 'date', label: 'Birth date' })
    expect(cf.datetime('seen_at')).toMatchObject({ key: 'seen_at', kind: 'datetime' })
  })

  test('CustomFieldKind type stays in sync with the runtime kinds list (#3042)', () => {
    // The CustomFieldKind type is derived from CUSTOM_FIELD_KINDS, so declaring a
    // field with any runtime kind — including date/datetime — must type-check.
    const dateField: CustomFieldDefinition = { key: 'birth_date', kind: 'date' }
    const dateTimeField: CustomFieldDefinition = { key: 'seen_at', kind: 'datetime' }
    expect(dateField.kind).toBe('date')
    expect(dateTimeField.kind).toBe('datetime')
    const everyRuntimeKind: CustomFieldKind[] = [...CUSTOM_FIELD_KINDS]
    expect(everyRuntimeKind).toContain('date')
    expect(everyRuntimeKind).toContain('datetime')
  })
})

