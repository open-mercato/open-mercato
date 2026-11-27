import { normalizeFindingSummary } from '../backend/documents/[id]/findingModel'
import {
  emptyRuleDraft,
  normalizeReviewPlaybookList,
  normalizeReviewRules,
  ruleDraftErrors,
  ruleDraftPayload,
} from '../backend/documents/review-playbooks/reviewPlaybookModel'

const SUMMARY = {
  reviewId: 'review-1',
  reviewedAt: '2026-11-12T10:00:00.000Z',
  open: { blocking: 1, warning: 0, info: 0 },
  decided: { applied: 0, kept: 0 },
  unlocated: 0,
}

describe('review playbook UI model', () => {
  it('reads the review playbook from the findings summary and tolerates its absence', () => {
    expect(normalizeFindingSummary({
      ...SUMMARY,
      playbook: { id: 'playbook-1', code: 'nda', name: 'NDA review', version: 4 },
    })?.playbook).toEqual({ id: 'playbook-1', code: 'nda', name: 'NDA review', version: 4 })
    expect(normalizeFindingSummary(SUMMARY)?.playbook).toBeNull()
  })

  it('normalizes playbook lists and sorts rules by order then code', () => {
    const list = normalizeReviewPlaybookList({
      items: [{ id: 'p1', code: 'nda', name: 'NDA', version: 2, isActive: true, updatedAt: '2026-11-12T10:00:00.000Z' }, { id: 'broken' }],
      total: 2,
      totalPages: 1,
    })
    expect(list.rows.map((row) => row.id)).toEqual(['p1'])
    const rules = normalizeReviewRules({
      items: [
        { id: 'r2', playbookId: 'p1', code: 'B', title: 'B', position: 'x', severity: 'info', sortOrder: 20, isActive: true },
        { id: 'r1', playbookId: 'p1', code: 'A', title: 'A', position: 'x', severity: 'blocking', sortOrder: 10, isActive: true },
      ],
    })
    expect(rules.map((rule) => rule.id)).toEqual(['r1', 'r2'])
  })

  it('validates rule drafts and maps blanks to null', () => {
    const draft = emptyRuleDraft(10)
    expect(ruleDraftErrors(draft)).toMatchObject({
      code: 'documents.reviewPlaybooks.validation.ruleCodeRequired',
      title: 'documents.reviewPlaybooks.validation.ruleTitleRequired',
      position: 'documents.reviewPlaybooks.validation.positionRequired',
    })
    expect(ruleDraftErrors({ ...draft, code: '-bad', title: 'T', position: 'P' }).code)
      .toBe('documents.reviewPlaybooks.validation.codeFormat')
    expect(ruleDraftPayload({ ...draft, code: 'NDA-3.1', title: 'Term', position: 'Two years.' })).toEqual({
      code: 'NDA-3.1',
      title: 'Term',
      topic: null,
      severity: 'warning',
      sortOrder: 10,
      isActive: true,
      position: 'Two years.',
      preferredWording: null,
    })
  })
})
