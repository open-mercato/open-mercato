/**
 * Completion-surface declaration (issue #7179).
 *
 * A step that declares `userTaskConfig.completion.surface: 'host'` is finished
 * in a host module's own UI; core must then offer no generic completion
 * affordance and deep-link to the declared host `href`. A step that omits the
 * key must behave exactly as before.
 */

import { describe, test, expect } from '@jest/globals'
import { userTaskConfigSchema } from '../../data/validators'
import {
  isHostCompletedTask,
  isSafeTaskCompletionHref,
  readTaskCompletion,
  resolveTaskCompletion,
  resolveTaskCompletionHref,
} from '../task-completion'

const identity = (value: unknown) => value
const fromContext = (context: Record<string, string>) => (value: unknown) =>
  typeof value === 'string'
    ? value.replace(/\{\{context\.([^}]+)\}\}/g, (match, key: string) => context[key] ?? match)
    : value

describe('userTaskConfigSchema.completion', () => {
  test('a config without the key parses exactly as before', () => {
    const config = { assignedTo: 'user-1', decisions: [{ id: 'ok', label: 'OK', transitionId: 't_1' }] }
    expect(userTaskConfigSchema.parse(config)).toEqual(config)
  })

  test('accepts a host declaration with a templated relative href', () => {
    const parsed = userTaskConfigSchema.parse({
      completion: { surface: 'host', href: '/backend/invoices/{{context.invoiceId}}/approve' },
    })
    expect(parsed.completion).toEqual({
      surface: 'host',
      href: '/backend/invoices/{{context.invoiceId}}/approve',
    })
  })

  test('accepts a host declaration without an href and an explicit core surface', () => {
    expect(userTaskConfigSchema.safeParse({ completion: { surface: 'host' } }).success).toBe(true)
    expect(userTaskConfigSchema.safeParse({ completion: { surface: 'core' } }).success).toBe(true)
  })

  test.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'backend/relative',
    'javascript:alert(1)',
    '/backend/with space',
  ])('refuses an href that could leave the panel origin: %s', (href) => {
    expect(userTaskConfigSchema.safeParse({ completion: { surface: 'host', href } }).success).toBe(false)
  })

  test('refuses an unknown surface', () => {
    expect(userTaskConfigSchema.safeParse({ completion: { surface: 'portal' } }).success).toBe(false)
  })
})

describe('resolveTaskCompletion', () => {
  test('absent, null and core all resolve to null — today\'s behaviour', () => {
    expect(resolveTaskCompletion(undefined, identity)).toBeNull()
    expect(resolveTaskCompletion(null, identity)).toBeNull()
    expect(resolveTaskCompletion({ surface: 'core', href: '/backend/x' }, identity)).toBeNull()
  })

  test('interpolates the href against the run context once', () => {
    const resolved = resolveTaskCompletion(
      { surface: 'host', href: '/backend/invoices/{{context.invoiceId}}' },
      fromContext({ invoiceId: 'inv-42' }),
    )
    expect(resolved).toEqual({ surface: 'host', href: '/backend/invoices/inv-42' })
  })

  test('drops an href whose token did not resolve, keeping the host declaration', () => {
    const resolved = resolveTaskCompletion(
      { surface: 'host', href: '/backend/invoices/{{context.missing}}' },
      fromContext({}),
    )
    expect(resolved).toEqual({ surface: 'host', href: null })
  })

  test('drops an href that interpolates into an off-origin URL', () => {
    const resolved = resolveTaskCompletion(
      { surface: 'host', href: '/{{context.next}}' },
      fromContext({ next: '/evil.example' }),
    )
    expect(resolved).toEqual({ surface: 'host', href: null })
  })

  test('a host declaration without an href renders in the injection spot', () => {
    expect(resolveTaskCompletion({ surface: 'host' }, identity)).toEqual({ surface: 'host', href: null })
  })
})

describe('readTaskCompletion and friends', () => {
  test('narrow stored values fail-closed', () => {
    expect(readTaskCompletion(null)).toBeNull()
    expect(readTaskCompletion('host')).toBeNull()
    expect(readTaskCompletion({ surface: 'core' })).toBeNull()
    expect(readTaskCompletion({ surface: 'host', href: 'https://evil.example' })).toEqual({
      surface: 'host',
      href: null,
    })
    expect(readTaskCompletion({ surface: 'host', href: '/backend/a' })).toEqual({
      surface: 'host',
      href: '/backend/a',
    })
  })

  test('isHostCompletedTask / resolveTaskCompletionHref', () => {
    expect(isHostCompletedTask(undefined)).toBe(false)
    expect(isHostCompletedTask({ surface: 'host', href: null })).toBe(true)
    expect(resolveTaskCompletionHref({ surface: 'host', href: '/backend/a' })).toBe('/backend/a')
    expect(resolveTaskCompletionHref({ surface: 'host', href: null })).toBeNull()
    expect(resolveTaskCompletionHref(null)).toBeNull()
  })

  test('isSafeTaskCompletionHref', () => {
    expect(isSafeTaskCompletionHref('/backend/a?b=c#d')).toBe(true)
    expect(isSafeTaskCompletionHref('/backend/{{context.x}}')).toBe(false)
    expect(isSafeTaskCompletionHref('//x')).toBe(false)
    expect(isSafeTaskCompletionHref(42)).toBe(false)
  })
})
