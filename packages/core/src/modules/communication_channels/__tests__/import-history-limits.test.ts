import {
  IMPORT_HISTORY_ABSOLUTE_MAX_PAGES,
  IMPORT_HISTORY_DEFAULT_MAX_MESSAGES,
  IMPORT_HISTORY_DEFAULT_SINCE_DAYS,
  IMPORT_HISTORY_MAX_MESSAGES_FALLBACK,
  IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK,
  IMPORT_HISTORY_MIN_PAGE_BUDGET,
  getImportHistoryLimits,
  resolveImportHistoryPageBudget,
} from '../lib/import-history-limits'
import { getQueueImportHistorySchema } from '../commands/queue-import-history'

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111'

describe('import history limits', () => {
  const originalSinceDays = process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS
  const originalMaxMessages = process.env.OM_IMPORT_HISTORY_MAX_MESSAGES

  afterEach(() => {
    if (originalSinceDays === undefined) delete process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS
    else process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS = originalSinceDays
    if (originalMaxMessages === undefined) delete process.env.OM_IMPORT_HISTORY_MAX_MESSAGES
    else process.env.OM_IMPORT_HISTORY_MAX_MESSAGES = originalMaxMessages
  })

  it('keeps the shipped defaults and ceilings', () => {
    expect(getImportHistoryLimits()).toEqual({
      defaultSinceDays: 30,
      defaultMaxMessages: 1000,
      maxSinceDays: 3650,
      maxMessages: 50000,
    })
    expect(IMPORT_HISTORY_DEFAULT_SINCE_DAYS).toBe(30)
    expect(IMPORT_HISTORY_DEFAULT_MAX_MESSAGES).toBe(1000)
    expect(IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK).toBe(3650)
    expect(IMPORT_HISTORY_MAX_MESSAGES_FALLBACK).toBe(50000)
  })

  it('applies the defaults when the request omits the fields', () => {
    const parsed = getQueueImportHistorySchema().parse({ channelId: CHANNEL_ID })
    expect(parsed.sinceDays).toBe(30)
    expect(parsed.maxMessages).toBe(1000)
  })

  it('accepts a multi-year backfill at the ceiling', () => {
    const parsed = getQueueImportHistorySchema().parse({
      channelId: CHANNEL_ID,
      sinceDays: 3650,
      maxMessages: 50000,
    })
    expect(parsed.sinceDays).toBe(3650)
    expect(parsed.maxMessages).toBe(50000)
  })

  it('still accepts the values the previous ceilings allowed', () => {
    const parsed = getQueueImportHistorySchema().parse({
      channelId: CHANNEL_ID,
      sinceDays: 365,
      maxMessages: 5000,
    })
    expect(parsed.sinceDays).toBe(365)
    expect(parsed.maxMessages).toBe(5000)
  })

  it('rejects values above the ceiling', () => {
    const schema = getQueueImportHistorySchema()
    expect(schema.safeParse({ channelId: CHANNEL_ID, sinceDays: 3651 }).success).toBe(false)
    expect(schema.safeParse({ channelId: CHANNEL_ID, maxMessages: 50001 }).success).toBe(false)
  })

  it('honours the env overrides at validation time', () => {
    process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS = '7300'
    process.env.OM_IMPORT_HISTORY_MAX_MESSAGES = '120000'
    expect(getImportHistoryLimits()).toMatchObject({ maxSinceDays: 7300, maxMessages: 120000 })

    const schema = getQueueImportHistorySchema()
    expect(schema.safeParse({ channelId: CHANNEL_ID, sinceDays: 7300, maxMessages: 120000 }).success).toBe(true)
    expect(schema.safeParse({ channelId: CHANNEL_ID, sinceDays: 7301 }).success).toBe(false)
  })

  it('never lets an override drop a ceiling below the default value', () => {
    process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS = '1'
    process.env.OM_IMPORT_HISTORY_MAX_MESSAGES = '10'
    expect(getImportHistoryLimits()).toMatchObject({ maxSinceDays: 30, maxMessages: 1000 })
  })

  it('ignores a non-numeric override', () => {
    process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS = 'not-a-number'
    expect(getImportHistoryLimits().maxSinceDays).toBe(3650)
  })

  it('caps the IMAP provider below the deployment-wide ceiling', () => {
    expect(getImportHistoryLimits('imap')).toMatchObject({ maxSinceDays: 365, maxMessages: 5000 })
  })

  it('never lets an env override raise the IMAP ceiling past its own cap', () => {
    process.env.OM_IMPORT_HISTORY_MAX_SINCE_DAYS = '7300'
    process.env.OM_IMPORT_HISTORY_MAX_MESSAGES = '120000'
    expect(getImportHistoryLimits('imap')).toMatchObject({ maxSinceDays: 365, maxMessages: 5000 })
  })

  it('leaves an unknown or unspecified provider at the deployment-wide ceiling', () => {
    expect(getImportHistoryLimits('gmail')).toMatchObject({ maxSinceDays: 3650, maxMessages: 50000 })
    expect(getImportHistoryLimits('unknown-provider')).toMatchObject({ maxSinceDays: 3650, maxMessages: 50000 })
  })
})

describe('resolveImportHistoryPageBudget', () => {
  it('derives the budget from the message cap', () => {
    expect(resolveImportHistoryPageBudget(50000)).toBe(IMPORT_HISTORY_ABSOLUTE_MAX_PAGES)
    expect(resolveImportHistoryPageBudget(2500)).toBe(2500)
  })

  it('keeps a floor for small imports and a ceiling for huge ones', () => {
    expect(resolveImportHistoryPageBudget(1)).toBe(IMPORT_HISTORY_MIN_PAGE_BUDGET)
    expect(resolveImportHistoryPageBudget(0)).toBe(IMPORT_HISTORY_MIN_PAGE_BUDGET)
    expect(resolveImportHistoryPageBudget(Number.NaN)).toBe(IMPORT_HISTORY_MIN_PAGE_BUDGET)
    expect(resolveImportHistoryPageBudget(10_000_000)).toBe(IMPORT_HISTORY_ABSOLUTE_MAX_PAGES)
  })

  it('is large enough to drain the previous 20k page-count ceiling', () => {
    expect(resolveImportHistoryPageBudget(IMPORT_HISTORY_MAX_MESSAGES_FALLBACK)).toBeGreaterThan(100)
  })
})
