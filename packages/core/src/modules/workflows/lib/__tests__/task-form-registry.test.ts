/**
 * External task form renderer registry (#4243, spec §6.1 §6) plus the
 * form-schema normalization it shares with the completion path.
 *
 * The load-bearing guarantee: an unknown `formKey` NEVER produces a blank
 * screen — it resolves to `missing`, which the surface renders as the built-in
 * form plus a visible notice.
 */

import { describe, test, expect, beforeEach } from '@jest/globals'
import {
  clearTaskFormRenderers,
  getTaskFormRenderer,
  listTaskFormRenderers,
  registerTaskFormRenderer,
  resolveTaskForm,
} from '../task-form-registry'
import {
  countTaskFormFields,
  normalizeTaskFormSchema,
  readRequiredFormFields,
} from '../task-form-schema'

const Renderer = (() => null) as never

describe('registerTaskFormRenderer', () => {
  beforeEach(() => clearTaskFormRenderers())

  test('resolves a registered renderer by its formKey', () => {
    registerTaskFormRenderer({ formKey: 'credit-check', Renderer })

    expect(getTaskFormRenderer('credit-check')?.formKey).toBe('credit-check')
    expect(listTaskFormRenderers()).toHaveLength(1)
  })

  test('refuses a duplicate key rather than letting import order decide', () => {
    registerTaskFormRenderer({ formKey: 'credit-check', Renderer })

    expect(() => registerTaskFormRenderer({ formKey: 'credit-check', Renderer })).toThrow(
      /already registered/
    )
  })

  test('refuses an entry with no key', () => {
    expect(() => registerTaskFormRenderer({ formKey: '', Renderer })).toThrow(/requires a formKey/)
  })

  test('a lookup miss returns null instead of throwing', () => {
    expect(getTaskFormRenderer('nope')).toBeNull()
    expect(getTaskFormRenderer(null)).toBeNull()
    expect(getTaskFormRenderer(undefined)).toBeNull()
  })
})

describe('resolveTaskForm', () => {
  beforeEach(() => clearTaskFormRenderers())

  test('no formKey means the built-in form, with nothing to announce', () => {
    expect(resolveTaskForm(null)).toEqual({ kind: 'builtin' })
    expect(resolveTaskForm('')).toEqual({ kind: 'builtin' })
  })

  test('a registered key renders the external form', () => {
    registerTaskFormRenderer({ formKey: 'credit-check', Renderer })

    const resolution = resolveTaskForm('credit-check')
    expect(resolution.kind).toBe('registered')
  })

  test('an unknown key degrades to the built-in form AND names what is missing', () => {
    expect(resolveTaskForm('credit-check')).toEqual({ kind: 'missing', formKey: 'credit-check' })
  })
})

describe('normalizeTaskFormSchema — both accepted shapes', () => {
  test('the JSON-Schema shape passes through unchanged', () => {
    const schema = {
      type: 'object' as const,
      properties: { amount: { type: 'number', title: 'Amount' } },
      required: ['amount'],
    }

    expect(normalizeTaskFormSchema(schema)).toBe(schema)
    expect(readRequiredFormFields(schema)).toEqual(['amount'])
    expect(countTaskFormFields(schema)).toBe(1)
  })

  test('the Studio `{ fields: [...] }` shape becomes renderable properties', () => {
    const schema = {
      fields: [
        { name: 'reason', type: 'textarea', label: 'Reason', required: true },
        { name: 'amount', type: 'number', label: 'Amount' },
        { name: 'grade', type: 'select', label: 'Grade', options: ['A', 'B'] },
        { name: 'agreed', type: 'checkbox', label: 'Agreed' },
        { name: 'contact', type: 'email', label: 'Contact' },
      ],
    }

    const normalized = normalizeTaskFormSchema(schema)

    expect(Object.keys(normalized?.properties ?? {})).toEqual([
      'reason',
      'amount',
      'grade',
      'agreed',
      'contact',
    ])
    expect(normalized?.properties?.reason).toMatchObject({ type: 'string', title: 'Reason' })
    expect(normalized?.properties?.amount).toMatchObject({ type: 'number' })
    expect(normalized?.properties?.grade).toMatchObject({ type: 'string', enum: ['A', 'B'] })
    expect(normalized?.properties?.agreed).toMatchObject({ type: 'boolean' })
    expect(normalized?.properties?.contact).toMatchObject({ type: 'string', format: 'email' })
  })

  test('the per-field required flag is what the fields shape validates on', () => {
    const schema = {
      fields: [
        { name: 'reason', type: 'text', label: 'Reason', required: true },
        { name: 'note', type: 'text', label: 'Note' },
      ],
    }

    expect(readRequiredFormFields(schema)).toEqual(['reason'])
    expect(countTaskFormFields(schema)).toBe(2)
  })

  test('an empty or absent schema declares nothing', () => {
    for (const schema of [null, undefined, {}, { fields: [] }, { properties: {} }, 'nonsense']) {
      expect(normalizeTaskFormSchema(schema)).toBeNull()
      expect(readRequiredFormFields(schema)).toEqual([])
      expect(countTaskFormFields(schema)).toBe(0)
    }
  })
})
