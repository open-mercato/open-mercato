import { collectCustomFieldValues } from '../customFieldValues'

describe('collectCustomFieldValues', () => {
  it('strips cf_ prefix by default', () => {
    const input = { cf_name: 'Alice', cf_age: 30, email: 'alice@example.com' }
    expect(collectCustomFieldValues(input)).toEqual({ name: 'Alice', age: 30 })
  })

  it('handles cf: prefix and keeps both by default', () => {
    const input = { 'cf:city': 'Berlin', cf_country: 'DE' }
    expect(collectCustomFieldValues(input)).toEqual({ city: 'Berlin', country: 'DE' })
  })

  it('applies transform and accept hooks', () => {
    const input = { cf_name: 'Alice', cf_notes: '', cf_skip: 'value' }
    const result = collectCustomFieldValues(input, {
      transform: (value) => (typeof value === 'string' ? value.trim() : value),
      accept: (fieldId) => fieldId !== 'skip',
    })
    expect(result).toEqual({ name: 'Alice', notes: '' })
  })

  it('retains prefix when stripPrefix is false', () => {
    const input = { cf_name: 'Alice' }
    expect(collectCustomFieldValues(input, { stripPrefix: false })).toEqual({ cf_name: 'Alice' })
  })

  it('omits undefined results when requested', () => {
    const input = { cf_name: 'Alice', cf_age: 30, cf_extra: null }
    const result = collectCustomFieldValues(input, {
      transform: (value, key) => (key === 'extra' ? undefined : value),
    })
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })
})
