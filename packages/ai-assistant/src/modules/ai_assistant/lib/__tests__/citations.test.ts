jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import {
  AI_CITATIONS_COMPONENT_ID,
  AI_CITATIONS_MAX_PER_CALL,
  AI_RUN_CITATIONS_MAX,
  aiCitationSchema,
  collectRunCitations,
  emitCitations,
  isSafeHref,
} from '../citations'
import { createToolUiPartBuffer, mergeUiPartsIntoToolResult } from '../tool-ui-parts'
import * as publicEntry from '../../../../index'
import {
  NON_STRING_CITATION_HREFS,
  SAFE_CITATION_HREFS,
  UNSAFE_CITATION_HREFS,
} from '@open-mercato/ui/ai/citations/__tests__/href-safety-cases'
import {
  AI_CITATIONS_COMPONENT_ID as UI_CITATIONS_COMPONENT_ID,
  isSafeCitationHref,
} from '@open-mercato/ui/ai/citations/registry'

describe('isSafeHref', () => {
  it.each([
    '/backend/customers/people/123',
    '/kb/refund-policy?version=4#section-2',
    'https://example.com/docs',
    'http://example.com',
    'HTTPS://Example.com/path',
  ])('accepts %s', (href) => {
    expect(isSafeHref(href)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    'mailto:someone@example.com',
    '//evil.example.com/path',
    '/\\evil.example.com',
    '\\\\evil.example.com',
    'https:evil.example.com',
    'https:/evil.example.com',
    'relative/path',
    '../up',
    '#anchor',
    '',
    'https://exa mple.com',
    '/path\nwith-newline',
    'https://example.com/\u200bhidden',
  ])('rejects %s', (href) => {
    expect(isSafeHref(href)).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isSafeHref(undefined)).toBe(false)
    expect(isSafeHref(null)).toBe(false)
    expect(isSafeHref(42)).toBe(false)
  })
})

describe('isSafeHref parity with the client-side check in @open-mercato/ui', () => {
  it.each([...SAFE_CITATION_HREFS, ...UNSAFE_CITATION_HREFS, ...NON_STRING_CITATION_HREFS])(
    'agrees on %p',
    (href) => {
      expect(isSafeHref(href)).toBe(isSafeCitationHref(href))
    },
  )

  it('accepts every shared safe href and rejects every shared unsafe href', () => {
    for (const href of SAFE_CITATION_HREFS) expect(isSafeHref(href)).toBe(true)
    for (const href of UNSAFE_CITATION_HREFS) expect(isSafeHref(href)).toBe(false)
  })

  it('uses the same citations component id as the client', () => {
    expect(UI_CITATIONS_COMPONENT_ID).toBe(AI_CITATIONS_COMPONENT_ID)
  })
})

describe('aiCitationSchema', () => {
  it('accepts a full citation', () => {
    const parsed = aiCitationSchema.safeParse({
      kind: 'kb',
      ref: 'refund-policy@4',
      label: 'Refund policy',
      version: '4',
      quote: 'Refunds are issued within 14 days.',
      locator: '§3.2',
      href: '/backend/kb/refund-policy',
      steps: ['S1', 'S2'],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a minimal AO-style citation', () => {
    expect(aiCitationSchema.safeParse({ kind: 'record', ref: 'customers.person:1' }).success).toBe(true)
  })

  it.each([
    [{ kind: 'KB', ref: 'x' }],
    [{ kind: 'kb with space', ref: 'x' }],
    [{ kind: 'kb', ref: '' }],
    [{ kind: 'kb', ref: 'x'.repeat(513) }],
    [{ kind: 'kb', ref: 'x', label: 'l'.repeat(201) }],
    [{ kind: 'kb', ref: 'x', quote: 'q'.repeat(1001) }],
    [{ kind: 'kb', ref: 'x', href: 'javascript:alert(1)' }],
    [{ kind: 'kb', ref: 'x', steps: Array.from({ length: 21 }, (_, index) => `S${index}`) }],
    [{ ref: 'x' }],
  ])('rejects %j', (candidate) => {
    expect(aiCitationSchema.safeParse(candidate).success).toBe(false)
  })
})

describe('emitCitations', () => {
  it('validates, drops invalid entries and enqueues one citations part', () => {
    const buffer = createToolUiPartBuffer()
    const accepted = emitCitations(
      { uiParts: buffer },
      [
        { kind: 'kb', ref: 'a', href: 'https://example.com/a' },
        { kind: 'kb', ref: 'b', href: 'javascript:alert(1)' },
        'not-a-citation',
      ],
      { title: 'Sources' },
    )
    expect(accepted).toEqual([{ kind: 'kb', ref: 'a', href: 'https://example.com/a' }])
    expect(buffer.drain()).toEqual([
      {
        componentId: AI_CITATIONS_COMPONENT_ID,
        payload: { citations: accepted, title: 'Sources' },
      },
    ])
  })

  it('dedupes by kind + ref (+ locator) keeping the first occurrence', () => {
    const buffer = createToolUiPartBuffer()
    const accepted = emitCitations({ uiParts: buffer }, [
      { kind: 'kb', ref: 'a', label: 'first' },
      { kind: 'kb', ref: 'a', label: 'second' },
      { kind: 'record', ref: 'a' },
      { kind: 'kb', ref: 'a', locator: 'p. 2' },
    ])
    expect(accepted.map((citation) => [citation.kind, citation.ref, citation.label, citation.locator])).toEqual([
      ['kb', 'a', 'first', undefined],
      ['record', 'a', undefined, undefined],
      ['kb', 'a', undefined, 'p. 2'],
    ])
    const [part] = buffer.drain()
    expect(part.payload).toEqual({ citations: accepted })
  })

  it('caps at the per-call maximum', () => {
    const buffer = createToolUiPartBuffer()
    const accepted = emitCitations(
      { uiParts: buffer },
      Array.from({ length: 35 }, (_, index) => ({ kind: 'kb', ref: `doc-${index}` })),
    )
    expect(accepted).toHaveLength(AI_CITATIONS_MAX_PER_CALL)
    expect(accepted[0].ref).toBe('doc-0')
    expect(accepted[AI_CITATIONS_MAX_PER_CALL - 1].ref).toBe(`doc-${AI_CITATIONS_MAX_PER_CALL - 1}`)
  })

  it('is a no-op without a collector but still returns the validated citations', () => {
    expect(emitCitations({}, [{ kind: 'kb', ref: 'a' }])).toEqual([{ kind: 'kb', ref: 'a' }])
    expect(emitCitations(undefined, [{ kind: 'kb', ref: 'a' }])).toEqual([{ kind: 'kb', ref: 'a' }])
  })

  it('enqueues nothing when no citation is valid', () => {
    const buffer = createToolUiPartBuffer()
    expect(emitCitations({ uiParts: buffer }, [{ kind: 'kb' }])).toEqual([])
    expect(buffer.drain()).toEqual([])
  })
})

describe('tool UI part buffer', () => {
  it('normalizes props to payload and drains once', () => {
    const buffer = createToolUiPartBuffer()
    buffer.enqueue({ componentId: 'sales:snapshot-card', props: { total: 1 } })
    buffer.enqueue({ componentId: 'sales:other', payload: { ok: true } })
    buffer.enqueue({ componentId: '' })
    expect(buffer.drain()).toEqual([
      { componentId: 'sales:snapshot-card', payload: { total: 1 } },
      { componentId: 'sales:other', payload: { ok: true } },
    ])
    expect(buffer.drain()).toEqual([])
  })
})

describe('mergeUiPartsIntoToolResult', () => {
  const part = { componentId: AI_CITATIONS_COMPONENT_ID, payload: { citations: [] } }

  it('returns the result untouched when there are no parts', () => {
    const objectResult = { ok: true }
    expect(mergeUiPartsIntoToolResult(objectResult, [])).toBe(objectResult)
    expect(mergeUiPartsIntoToolResult('plain text', [])).toBe('plain text')
    expect(mergeUiPartsIntoToolResult(7, [])).toBe(7)
    expect(mergeUiPartsIntoToolResult(null, [])).toBeNull()
  })

  it('adds a uiParts envelope to object results', () => {
    expect(mergeUiPartsIntoToolResult({ ok: true }, [part])).toEqual({ ok: true, uiParts: [part] })
  })

  it('appends after uiParts the tool returned itself', () => {
    const own = { componentId: 'sales:card', payload: { id: 1 } }
    expect(mergeUiPartsIntoToolResult({ ok: true, uiParts: [own] }, [part])).toEqual({
      ok: true,
      uiParts: [own, part],
    })
  })

  it('keeps a non-array uiParts field and drops the emitted parts', () => {
    const result = { uiParts: 'custom' }
    expect(mergeUiPartsIntoToolResult(result, [part])).toBe(result)
  })

  it('wraps non-object results', () => {
    expect(mergeUiPartsIntoToolResult('text', [part])).toEqual({ result: 'text', uiParts: [part] })
    expect(mergeUiPartsIntoToolResult([1, 2], [part])).toEqual({ result: [1, 2], uiParts: [part] })
    expect(mergeUiPartsIntoToolResult(undefined, [part])).toEqual({ result: null, uiParts: [part] })
  })
})

describe('public entry', () => {
  it('exports the citations helpers', () => {
    expect(publicEntry.emitCitations).toBe(emitCitations)
    expect(publicEntry.aiCitationSchema).toBe(aiCitationSchema)
    expect(publicEntry.isSafeHref).toBe(isSafeHref)
    expect(publicEntry.AI_CITATIONS_COMPONENT_ID).toBe('ai_assistant:citations')
  })
})

describe('collectRunCitations', () => {
  const part = (citations: unknown[], extra: Record<string, unknown> = {}) => ({
    componentId: AI_CITATIONS_COMPONENT_ID,
    payload: { citations, ...extra },
  })

  it('reads citation parts from JSON-string and object tool outputs and dedupes across tool calls', () => {
    const first = JSON.stringify({
      items: [],
      uiParts: [
        part([{ kind: 'kb', ref: 'refunds@3', label: 'Refunds' }, { kind: 'record', ref: 'catalog:product:p1' }]),
        { componentId: 'other:part', payload: { citations: [{ kind: 'kb', ref: 'ignored' }] } },
      ],
    })
    const second = {
      result: null,
      uiParts: [part([{ kind: 'kb', ref: 'refunds@3', label: 'Duplicate' }, { kind: 'url', ref: 'https://example.com/a', href: 'https://example.com/a' }])],
    }
    expect(collectRunCitations([first, second, 'plain text', null, undefined])).toEqual([
      { kind: 'kb', ref: 'refunds@3', label: 'Refunds' },
      { kind: 'record', ref: 'catalog:product:p1' },
      { kind: 'url', ref: 'https://example.com/a', href: 'https://example.com/a' },
    ])
  })

  it('accepts a single uiPart envelope and legacy props payloads', () => {
    const result = {
      uiPart: { componentId: AI_CITATIONS_COMPONENT_ID, props: { citations: [{ kind: 'kb', ref: 'a' }] } },
    }
    expect(collectRunCitations([result])).toEqual([{ kind: 'kb', ref: 'a' }])
  })

  it('keeps entries with the same ref but a different locator and drops invalid or unsafe entries', () => {
    const result = {
      uiParts: [
        part([
          { kind: 'kb', ref: 'a', locator: 'p. 1' },
          { kind: 'kb', ref: 'a', locator: 'p. 2' },
          { kind: 'BAD KIND', ref: 'x' },
          { kind: 'url', ref: 'x', href: 'javascript:alert(1)' },
        ]),
      ],
    }
    expect(collectRunCitations([result])).toEqual([
      { kind: 'kb', ref: 'a', locator: 'p. 1' },
      { kind: 'kb', ref: 'a', locator: 'p. 2' },
    ])
  })

  it('caps the run at AI_RUN_CITATIONS_MAX citations', () => {
    const results = Array.from({ length: 4 }, (_, call) => ({
      uiParts: [part(Array.from({ length: 20 }, (_, index) => ({ kind: 'kb', ref: `doc-${call}-${index}` })))],
    }))
    const collected = collectRunCitations(results)
    expect(collected).toHaveLength(AI_RUN_CITATIONS_MAX)
    expect(collected[0]).toEqual({ kind: 'kb', ref: 'doc-0-0' })
  })

  it('round-trips emitCitations output merged into a tool result', () => {
    const buffer = createToolUiPartBuffer()
    emitCitations({ uiParts: buffer }, [{ kind: 'kb', ref: 'a' }], { title: 'Docs' })
    const output = JSON.stringify(mergeUiPartsIntoToolResult({ ok: true }, buffer.drain()))
    expect(collectRunCitations([output])).toEqual([{ kind: 'kb', ref: 'a' }])
  })
})
