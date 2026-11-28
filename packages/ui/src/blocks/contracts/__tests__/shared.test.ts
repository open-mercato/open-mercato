import {
  blockActionSchema,
  blockBasePropsSchema,
  blockStatusSchema,
  callbackSchema,
  hasUniqueIds,
  hasUniqueKeys,
  iconNameSchema,
  isoDateTimeSchema,
  slotSchema,
} from '../shared'

describe('shared block contract primitives', () => {
  it('accepts the four block statuses only', () => {
    for (const status of ['loading', 'error', 'empty', 'ready']) {
      expect(blockStatusSchema.safeParse(status).success).toBe(true)
    }
    expect(blockStatusSchema.safeParse('idle').success).toBe(false)
  })

  it('accepts kebab-case lucide icon names', () => {
    expect(iconNameSchema.safeParse('calendar-check').success).toBe(true)
    expect(iconNameSchema.safeParse('CalendarCheck').success).toBe(false)
    expect(iconNameSchema.safeParse('calendar_check').success).toBe(false)
  })

  it('requires ISO 8601 date-times with an offset', () => {
    expect(isoDateTimeSchema.safeParse('2026-11-24T10:00:00Z').success).toBe(true)
    expect(isoDateTimeSchema.safeParse('2026-11-24T10:00:00+01:00').success).toBe(true)
    expect(isoDateTimeSchema.safeParse('2026-11-24T10:00:00').success).toBe(false)
    expect(isoDateTimeSchema.safeParse('24.11.2026').success).toBe(false)
  })

  it('validates actions and ties disabledReason to disabled', () => {
    expect(blockActionSchema.safeParse({ key: 'delete', label: 'Delete', tone: 'destructive' }).success).toBe(true)
    expect(blockActionSchema.safeParse({ key: '', label: 'Delete' }).success).toBe(false)
    expect(blockActionSchema.safeParse({ key: 'delete', label: 'Delete', disabledReason: 'Locked' }).success).toBe(false)
    expect(
      blockActionSchema.safeParse({ key: 'delete', label: 'Delete', disabled: true, disabledReason: 'Locked' }).success,
    ).toBe(true)
  })

  it('accepts functions only in callback slots', () => {
    const schema = callbackSchema<() => void>()
    expect(schema.safeParse(() => undefined).success).toBe(true)
    expect(schema.safeParse('not a function').success).toBe(false)
  })

  it('accepts optional base props', () => {
    expect(blockBasePropsSchema.safeParse({}).success).toBe(true)
    expect(blockBasePropsSchema.safeParse({ status: 'error', errorMessage: 'Failed' }).success).toBe(true)
    expect(blockBasePropsSchema.safeParse({ status: 'broken' }).success).toBe(false)
  })

  it('detects duplicate keys', () => {
    expect(hasUniqueKeys([{ key: 'a' }, { key: 'b' }])).toBe(true)
    expect(hasUniqueKeys([{ key: 'a' }, { key: 'a' }])).toBe(false)
    expect(hasUniqueKeys(undefined)).toBe(true)
  })

  it('detects duplicate ids', () => {
    expect(hasUniqueIds([{ id: 'a' }, { id: 'b' }])).toBe(true)
    expect(hasUniqueIds([{ id: 'a' }, { id: 'a' }])).toBe(false)
    expect(hasUniqueIds(undefined)).toBe(true)
  })

  it('tags slots and callbacks with registry metadata', () => {
    expect(slotSchema.meta()?.kind).toBe('slot')
    expect(callbackSchema().meta()?.kind).toBe('event')
  })
})
