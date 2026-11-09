/** @jest-environment node */

const emitFormsEvent = jest.fn(async () => undefined)

jest.mock('../events', () => ({
  emitFormsEvent: (...args: unknown[]) => emitFormsEvent(...args),
}))

import { Form, FormSubmission, FormVersion } from '../data/entities'
import handle from '../workers/retention-purge'

const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const FORM_ID = '00000000-0000-0000-0000-000000000003'
const VERSION_ID = '00000000-0000-0000-0000-000000000004'

describe('forms retention purge worker', () => {
  it('uses stable keyset pages while anonymization removes rows from the candidate set', async () => {
    const form = {
      id: FORM_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      retentionDays: 30,
      deletedAt: null,
    }
    const version = {
      id: VERSION_ID,
      formId: FORM_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
    }
    const oldDate = new Date('2025-01-01T00:00:00Z')
    const submissions = Array.from({ length: 5 }, (_, index) => ({
      id: `00000000-0000-0000-0000-00000000010${index}`,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      formVersionId: VERSION_ID,
      status: 'submitted',
      submittedAt: oldDate,
      updatedAt: oldDate,
      anonymizedAt: null as Date | null,
      deletedAt: null,
    }))

    const find = jest.fn(async (EntityClass: unknown, where: Record<string, unknown>, options?: {
      limit?: number
      offset?: number
      orderBy?: Record<string, 'asc' | 'desc'>
    }) => {
      if (EntityClass === Form) return [form]
      if (EntityClass === FormVersion) return [version]
      if (EntityClass !== FormSubmission) return []

      const cursor = typeof where.id === 'object' && where.id !== null
        ? (where.id as { $gt?: string }).$gt
        : undefined
      const candidates = submissions
        .filter((submission) => submission.anonymizedAt === null)
        .filter((submission) => !cursor || submission.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id))
      return candidates.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? candidates.length))
    })
    const anonymize = jest.fn(async (submissionId: string) => {
      const submission = submissions.find((candidate) => candidate.id === submissionId)
      if (!submission) throw new Error('[internal] missing test submission')
      submission.anonymizedAt = new Date()
      return { revisionsAnonymized: 1, submissionAnonymizedAt: submission.anonymizedAt }
    })
    const resolve = <T,>(name: string): T => {
      if (name === 'em') return { find } as T
      if (name === 'formsAnonymizeService') return { anonymize } as T
      throw new Error(`[internal] unexpected dependency ${name}`)
    }

    await handle(
      {
        payload: {
          scope: { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID },
          batchSize: 2,
        },
      } as never,
      { resolve } as never,
    )

    expect(anonymize.mock.calls.map(([submissionId]) => submissionId)).toEqual(
      submissions.map((submission) => submission.id),
    )
    expect(find.mock.calls.filter(([EntityClass]) => EntityClass === FormSubmission)).toHaveLength(3)
    expect(emitFormsEvent).toHaveBeenCalledTimes(5)
  })
})
