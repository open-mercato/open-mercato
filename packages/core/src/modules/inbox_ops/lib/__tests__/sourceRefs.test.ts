/** @jest-environment node */

import { normalizeSourceRefs } from '../sourceRefs'
import { renderAttachmentPromptName, unescapePromptAttribute } from '../extractionPrompt'

const PDF_ID = '11111111-1111-4111-8111-111111111111'
const CSV_ID = '22222222-2222-4222-8222-222222222222'
const parts = [
  { attachmentId: PDF_ID, fileName: 'order.pdf' },
  { attachmentId: CSV_ID, fileName: 'lines.csv' },
]

describe('normalizeSourceRefs', () => {
  it('returns no refs for a missing or empty list', () => {
    expect(normalizeSourceRefs(undefined, parts)).toEqual([])
    expect(normalizeSourceRefs([], parts)).toEqual([])
  })

  it('keeps attachment refs to stored parts with the ledger file name, and drops other ids', () => {
    expect(
      normalizeSourceRefs(
        [
          { kind: 'attachment', attachmentId: PDF_ID.toUpperCase(), fileName: 'model-name.pdf', page: 2, snippet: ' 20 x  Widget ' },
          { kind: 'attachment', attachmentId: '33333333-3333-4333-8333-333333333333', snippet: 'foreign' },
          { kind: 'attachment', attachmentId: 'not-a-uuid', snippet: 'garbage' },
        ],
        parts,
      ),
    ).toEqual([{ kind: 'attachment', attachmentId: PDF_ID, fileName: 'order.pdf', page: 2, snippet: '20 x Widget' }])
  })

  it('resolves an attachment ref without an id only by a file name that names exactly one part', () => {
    const duplicated = [...parts, { attachmentId: '44444444-4444-4444-8444-444444444444', fileName: 'lines.csv' }]
    expect(
      normalizeSourceRefs(
        [
          { kind: 'attachment', fileName: 'order.pdf', snippet: 'a' },
          { kind: 'attachment', fileName: 'lines.csv', snippet: 'b' },
          { kind: 'attachment', snippet: 'c' },
        ],
        duplicated,
      ),
    ).toEqual([{ kind: 'attachment', attachmentId: PDF_ID, fileName: 'order.pdf', snippet: 'a' }])
  })

  it('resolves a file-name echo against the escaped and clipped name the prompt showed', () => {
    const QA_ID = '55555555-5555-4555-8555-555555555555'
    const LONG_ID = '66666666-6666-4666-8666-666666666666'
    const longName = `${'"'.repeat(60)}${'x'.repeat(300)}.pdf`
    const named = [
      { attachmentId: QA_ID, fileName: 'Q&A.pdf' },
      { attachmentId: LONG_ID, fileName: longName },
    ]
    const shownLongName = renderAttachmentPromptName(longName)
    expect(
      normalizeSourceRefs(
        [
          { kind: 'attachment', fileName: 'Q&amp;A.pdf', snippet: 'escaped echo' },
          { kind: 'attachment', fileName: 'Q&A.pdf', snippet: 'decoded echo' },
          { kind: 'attachment', fileName: shownLongName, snippet: 'clipped echo' },
          { kind: 'attachment', fileName: unescapePromptAttribute(shownLongName).slice(0, -1), snippet: 'clipped, no ellipsis' },
          { kind: 'attachment', fileName: 'Q&amp;B.pdf', snippet: 'other name' },
        ],
        named,
      ).map((ref) => [ref.attachmentId, ref.snippet]),
    ).toEqual([
      [QA_ID, 'escaped echo'],
      [QA_ID, 'decoded echo'],
      [LONG_ID, 'clipped echo'],
      [LONG_ID, 'clipped, no ellipsis'],
    ])
  })

  it('drops attachment refs when the email has no stored parts', () => {
    expect(normalizeSourceRefs([{ kind: 'attachment', attachmentId: PDF_ID, snippet: 'x' }], [])).toEqual([])
  })

  it('keeps only the snippet of email_body refs', () => {
    expect(
      normalizeSourceRefs([{ kind: 'email_body', attachmentId: PDF_ID, fileName: 'x', page: 1, row: 3, snippet: 'body quote' }], parts),
    ).toEqual([{ kind: 'email_body', snippet: 'body quote' }])
  })

  it('clips snippets and sheets, drops empty snippets and invalid page/row values, and caps the count', () => {
    const refs = normalizeSourceRefs(
      [
        { kind: 'email_body', snippet: '   ' },
        { kind: 'attachment', attachmentId: CSV_ID, sheet: 'S'.repeat(150), row: -1, page: 1.7, snippet: 'q'.repeat(600) },
        ...Array.from({ length: 15 }, (_, index) => ({ kind: 'email_body' as const, snippet: `quote ${index}` })),
      ],
      parts,
    )
    expect(refs).toHaveLength(10)
    expect(refs[0]).toEqual({ kind: 'attachment', attachmentId: CSV_ID, fileName: 'lines.csv', page: 1, sheet: 'S'.repeat(100), snippet: 'q'.repeat(500) })
  })

  it('never splits a surrogate pair at the clip limit', () => {
    const [ref] = normalizeSourceRefs([{ kind: 'email_body', snippet: `${'q'.repeat(499)}\u{1F600}tail` }], parts)
    expect(ref.snippet).toBe('q'.repeat(499))
  })

  it('renders each part name once per call, however many name-only refs the model returns', () => {
    const manyParts = Array.from({ length: 100 }, (_, index) => ({
      attachmentId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      fileName: `${'n'.repeat(250)}${index}.pdf`,
    }))
    const refs = Array.from({ length: 2000 }, () => ({ kind: 'attachment' as const, fileName: 'n'.repeat(255), snippet: 'x' }))
    const started = Date.now()
    expect(normalizeSourceRefs(refs, manyParts)).toEqual([])
    expect(Date.now() - started).toBeLessThan(500)
  })
})
