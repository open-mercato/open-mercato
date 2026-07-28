/**
 * Work Inbox presentation + client query forwarding.
 *
 * The DS rules the retired task list broke are pinned as tests, not comments:
 * the page it replaced hard-coded `bg-yellow-100` / `bg-blue-100` /
 * `bg-green-100` badges and `text-red-600` overdue markers, and rendered status
 * as colour with a label but no icon.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORK_INBOX_OVERDUE_TONE,
  describeWorkInboxPriority,
  describeWorkInboxStatus,
} from '../work-inbox/presentation'
import { WORK_INBOX_PRIORITIES } from '../work-inbox/provider'
import {
  WORK_INBOX_MAX_LIMIT,
  buildWorkInboxListQueryParams,
  parseWorkInboxQuery,
} from '../work-inbox/query'

const moduleRoot = join(__dirname, '..', '..')

describe('work inbox status presentation', () => {
  test('every known status pairs a design-system token with its own icon', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ESCALATED']) {
      const descriptor = describeWorkInboxStatus(status)
      expect(descriptor.badge).toMatch(/^bg-status-[a-z]+-bg text-status-[a-z]+-text$/)
      expect(descriptor.iconName.length).toBeGreaterThan(0)
    }
  })

  test('distinct statuses get distinct icons, so colour is never the only signal', () => {
    const icons = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ESCALATED'].map(
      (status) => describeWorkInboxStatus(status).iconName,
    )

    expect(new Set(icons).size).toBe(icons.length)
  })

  test('an unknown status from a third-party source renders neutrally instead of crashing', () => {
    const descriptor = describeWorkInboxStatus('SOMETHING_ELSE')

    expect(descriptor.badge).toContain('status-neutral')
    expect(descriptor.iconName).toBe('Circle')
  })

  test('every priority has its own token and icon, and an unset one has neither', () => {
    const icons = WORK_INBOX_PRIORITIES.map((priority) => describeWorkInboxPriority(priority)?.iconName)

    expect(new Set(icons).size).toBe(WORK_INBOX_PRIORITIES.length)
    expect(describeWorkInboxPriority(null)).toBeNull()
  })

  test('overdue uses the error token and carries a warning icon', () => {
    expect(WORK_INBOX_OVERDUE_TONE.badge).toContain('status-error')
    expect(WORK_INBOX_OVERDUE_TONE.text).toBe('text-status-error-text')
    expect(WORK_INBOX_OVERDUE_TONE.iconName).toBe('AlertTriangle')
  })
})

describe('work inbox surfaces carry no hard-coded status colours', () => {
  const guardedFiles = ['lib/work-inbox/presentation.ts', 'backend/work-inbox/page.tsx']
  const RAW_STATUS_COLOR = /\b(?:bg|text|border)-(?:red|green|yellow|amber|blue|emerald|orange|rose)-\d{2,3}\b/g
  const ARBITRARY_VALUE = /\b(?:text|p|m|w|h|rounded|z)-\[[^\]]+\]/g

  /** Comments name the tokens these files were migrated AWAY from. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  test.each(guardedFiles)('%s uses design-system tokens only', (relativePath) => {
    const source = stripComments(readFileSync(join(moduleRoot, relativePath), 'utf8'))

    expect(source.match(RAW_STATUS_COLOR) ?? []).toEqual([])
    expect(source.match(ARBITRARY_VALUE) ?? []).toEqual([])
  })
})

describe('work inbox client query forwarding', () => {
  test('forwards every filter the page offers', () => {
    const params = buildWorkInboxListQueryParams(
      {
        kind: 'user_task',
        module: 'workflows',
        entityType: 'sales:order',
        role: 'approver',
        priority: 'high',
        status: 'PENDING',
        overdue: 'true',
        myWork: 'true',
      },
      { limit: 50, offset: 0 },
    )

    expect(params.get('kind')).toBe('user_task')
    expect(params.get('module')).toBe('workflows')
    expect(params.get('entityType')).toBe('sales:order')
    expect(params.get('role')).toBe('approver')
    expect(params.get('priority')).toBe('high')
    expect(params.get('status')).toBe('PENDING')
    expect(params.get('overdue')).toBe('true')
    expect(params.get('myWork')).toBe('true')
  })

  test('drops empty filters instead of sending blank narrowings', () => {
    const params = buildWorkInboxListQueryParams({ kind: '', overdue: '' }, { limit: 25, offset: 25 })

    expect(params.has('kind')).toBe(false)
    expect(params.has('overdue')).toBe(false)
    expect(params.get('offset')).toBe('25')
  })

  test('never asks the server for more than the platform page-size cap', () => {
    const params = buildWorkInboxListQueryParams({}, { limit: 5000, offset: 0 })

    expect(params.get('limit')).toBe(String(WORK_INBOX_MAX_LIMIT))
  })

  test('what the page sends round-trips through the server parser', () => {
    const params = buildWorkInboxListQueryParams(
      { kind: 'user_task', role: 'approver', priority: 'high', overdue: 'true', myWork: 'true' },
      { limit: 50, offset: 0 },
    )
    const parsed = parseWorkInboxQuery(params, new Date('2026-07-28T12:00:00.000Z'))

    expect(parsed.kinds).toEqual(['user_task'])
    expect(parsed.roles).toEqual(['approver'])
    expect(parsed.priorities).toEqual(['high'])
    expect(parsed.overdueOnly).toBe(true)
    expect(parsed.myWork).toBe(true)
  })

  test('an unknown priority label is dropped rather than passed through as a filter', () => {
    const parsed = parseWorkInboxQuery(
      new URLSearchParams('priority=urgent'),
      new Date('2026-07-28T12:00:00.000Z'),
    )

    expect(parsed.priorities).toBeNull()
  })
})
