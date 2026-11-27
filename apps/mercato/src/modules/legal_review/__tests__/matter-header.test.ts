/** @jest-environment node */
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  buildMatterListPath,
  buildStageStatusLine,
  formatJurisdiction,
  isMatterOverdue,
  pickMatterFromListResponse,
  readDocumentIdFromContext,
} from '../lib/matterHeader'
import { buildLegalMatterSteps, canReleaseFromStage, normalizeLegalMatterStage } from '../lib/stages'
import { applyUserLabels, toLegalMatterItem } from '../lib/matterItems'

const DOCUMENT_ID = '3f0b8f4e-7c55-4f4e-9d61-2f8a0c1b5d10'
const MATTER_ID = '9b1d2c3e-4f50-4a61-8b72-0c1d2e3f4a5b'
const ORG_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d'
const ASSIGNEE_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

const translate: TranslateFn = (key, fallbackOrParams, params) => {
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const values = typeof fallbackOrParams === 'object' ? fallbackOrParams : params ?? {}
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    fallback,
  )
}

function matterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATTER_ID,
    document_id: DOCUMENT_ID,
    reference: 'LG-1042',
    counterparty: 'Northwind Traders',
    purpose: 'Evaluation of a joint logistics pilot',
    jurisdiction: 'DE',
    agreement_type: 'mutual_nda',
    paper: 'counterparty',
    requested_by_user_id: null,
    assignee_user_id: ASSIGNEE_ID,
    stage: 'review',
    due_at: null,
    organization_id: ORG_ID,
    tenant_id: ORG_ID,
    created_at: '2026-11-10T08:00:00.000Z',
    updated_at: '2026-11-11T08:00:00.000Z',
    ...overrides,
  }
}

describe('legal matter header helpers', () => {
  it('reads the document id from the spot context, falling back to the document', () => {
    expect(readDocumentIdFromContext({ documentId: DOCUMENT_ID })).toBe(DOCUMENT_ID)
    expect(readDocumentIdFromContext({ document: { id: DOCUMENT_ID } })).toBe(DOCUMENT_ID)
    expect(readDocumentIdFromContext({ documentId: '  ' })).toBeNull()
    expect(readDocumentIdFromContext(null)).toBeNull()
  })

  it('builds a list path filtered by document id', () => {
    const path = buildMatterListPath(DOCUMENT_ID)
    expect(path.startsWith('/api/legal_review/matters?')).toBe(true)
    expect(new URLSearchParams(path.split('?')[1]).get('documentId')).toBe(DOCUMENT_ID)
  })

  it('picks the first valid matter and ignores malformed responses', () => {
    const item = toLegalMatterItem(matterRow())
    expect(pickMatterFromListResponse({ items: [item] })?.reference).toBe('LG-1042')
    expect(pickMatterFromListResponse({ items: [] })).toBeNull()
    expect(pickMatterFromListResponse({ items: [{ id: 'x' }] })).toBeNull()
    expect(pickMatterFromListResponse(null)).toBeNull()
  })

  it('marks steps before the current stage complete', () => {
    expect(buildLegalMatterSteps('review').map((step) => step.state)).toEqual([
      'complete',
      'current',
      'pending',
      'pending',
    ])
    expect(buildLegalMatterSteps('unknown')[0].state).toBe('current')
    expect(normalizeLegalMatterStage('signing')).toBe('signing')
  })

  it('only releases matters that are still before release', () => {
    expect(canReleaseFromStage('requested')).toBe(true)
    expect(canReleaseFromStage('review')).toBe(true)
    expect(canReleaseFromStage('released')).toBe(false)
    expect(canReleaseFromStage('signing')).toBe(false)
  })

  it('describes the current stage with the assignee and the due date', () => {
    const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const line = buildStageStatusLine(
      { stage: 'review', assigneeLabel: 'Avery Lin', requestedByLabel: null, dueAt },
      translate,
      'en',
    )
    expect(line).toBe('Avery Lin is reviewing · due in 3 days')
    expect(
      buildStageStatusLine({ stage: 'released', assigneeLabel: 'Avery Lin', requestedByLabel: 'Sam Rivera', dueAt }, translate, 'en'),
    ).toBe('Released to Sam Rivera')
    expect(
      buildStageStatusLine({ stage: 'requested', assigneeLabel: null, requestedByLabel: null, dueAt: null }, translate, 'en'),
    ).toBe('Waiting for Unassigned')
  })
})

describe('legal matter items', () => {
  it('maps query rows to API items and falls back on unknown enum values', () => {
    const item = toLegalMatterItem(matterRow({ agreement_type: 'msa', paper: 'theirs', stage: 'archived' }))
    expect(item).toMatchObject({
      documentId: DOCUMENT_ID,
      agreementType: 'other',
      paper: 'counterparty',
      stage: 'requested',
      assigneeUserId: ASSIGNEE_ID,
      updatedAt: '2026-11-11T08:00:00.000Z',
    })
  })

  it('resolves user labels through the auth principal service', async () => {
    const resolveLabels = jest.fn(async () => [{ id: ASSIGNEE_ID, label: 'Avery Lin', secondary: null }])
    const container = { resolve: () => ({ resolveLabels }) }
    const [item] = await applyUserLabels(container, { tenantId: ORG_ID, organizationId: ORG_ID }, [
      toLegalMatterItem(matterRow()),
    ])
    expect(resolveLabels).toHaveBeenCalledWith({
      type: 'user',
      ids: [ASSIGNEE_ID],
      scope: { tenantId: ORG_ID, organizationId: ORG_ID },
    })
    expect(item.assigneeLabel).toBe('Avery Lin')
    expect(item.requestedByLabel).toBeNull()
  })

  it('leaves labels empty when the principal service is unavailable', async () => {
    const container = {
      resolve: () => {
        throw new Error('not registered')
      },
    }
    const [item] = await applyUserLabels(container, { tenantId: ORG_ID, organizationId: ORG_ID }, [
      toLegalMatterItem(matterRow()),
    ])
    expect(item.assigneeLabel).toBeNull()
  })
})

describe('matter header display helpers', () => {
  it('names the jurisdiction region and falls back to the code', () => {
    expect(formatJurisdiction('US', 'en')).toBe('United States')
    expect(formatJurisdiction('gb', 'en')).toBe('United Kingdom')
    expect(formatJurisdiction(null, 'en')).toBeNull()
  })

  it('flags overdue matters only before release', () => {
    const now = Date.parse('2026-11-12T10:00:00Z')
    const past = '2026-11-12T09:00:00Z'
    const future = '2026-11-13T09:00:00Z'
    expect(isMatterOverdue({ stage: 'review', dueAt: past }, now)).toBe(true)
    expect(isMatterOverdue({ stage: 'review', dueAt: future }, now)).toBe(false)
    expect(isMatterOverdue({ stage: 'released', dueAt: past }, now)).toBe(false)
    expect(isMatterOverdue({ stage: 'requested', dueAt: null }, now)).toBe(false)
  })
})
