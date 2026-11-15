import {
  AnalyticsService,
  buildFunnel,
  buildTimeToComplete,
  buildVolume,
  furthestSectionReached,
} from '../services/analytics-service'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import type { EncryptionService } from '../services/encryption-service'
import { FormSubmission, FormSubmissionRevision, FormVersion } from '../data/entities'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const FORM_ID = '00000000-0000-0000-0000-000000000020'
const VERSION_ID = '00000000-0000-0000-0000-000000000011'

const SCHEMA = {
  type: 'object',
  'x-om-roles': ['patient'],
  'x-om-default-actor-role': 'patient',
  'x-om-sections': [
    { key: 'sec_a', title: { en: 'A' }, fieldKeys: ['rating', 'agree'] },
    { key: 'sec_b', title: { en: 'B' }, fieldKeys: ['comments', 'diagnosis'] },
  ],
  properties: {
    rating: {
      type: 'string',
      'x-om-type': 'select_one',
      'x-om-label': { en: 'Rating' },
      'x-om-options': [
        { value: 'good', label: { en: 'Good' } },
        { value: 'bad', label: { en: 'Bad' } },
      ],
      'x-om-editable-by': ['patient'],
    },
    agree: {
      type: 'boolean',
      'x-om-type': 'boolean',
      'x-om-label': { en: 'Agree' },
      'x-om-editable-by': ['patient'],
    },
    comments: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-label': { en: 'Comments' },
      'x-om-editable-by': ['patient'],
    },
    diagnosis: {
      type: 'string',
      'x-om-type': 'select_one',
      'x-om-label': { en: 'Diagnosis' },
      'x-om-sensitive': true,
      'x-om-options': [
        { value: 'flu', label: { en: 'Flu' } },
        { value: 'cold', label: { en: 'Cold' } },
      ],
      'x-om-editable-by': ['patient'],
    },
  },
}

type Row = Record<string, unknown>

class StubEntityManager {
  rows: Map<unknown, Row[]> = new Map()

  seed(EntityClass: new () => unknown, items: Row[]): void {
    this.rows.set(EntityClass, items)
  }

  async findOne<T>(EntityClass: new () => T, where: Partial<T>): Promise<T | null> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    return list.find((row) => matches(row, where)) ?? null
  }

  async find<T>(
    EntityClass: new () => T,
    where: Partial<T>,
    options?: { orderBy?: Record<string, 'asc' | 'desc'>; limit?: number },
  ): Promise<T[]> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    let filtered = list.filter((row) => matches(row, where))
    if (options?.orderBy) {
      const [[field, direction]] = Object.entries(options.orderBy)
      filtered = [...filtered].sort((a, b) => {
        const av = (a as Record<string, unknown>)[field]
        const bv = (b as Record<string, unknown>)[field]
        const at = av instanceof Date ? av.getTime() : Number(av ?? 0)
        const bt = bv instanceof Date ? bv.getTime() : Number(bv ?? 0)
        return direction === 'asc' ? at - bt : bt - at
      })
    }
    if (typeof options?.limit === 'number') filtered = filtered.slice(0, options.limit)
    return filtered
  }
}

function matches(row: unknown, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key]
    if (value && typeof value === 'object' && '$in' in (value as object)) {
      const list = (value as { $in: unknown[] }).$in
      return list.includes(actual)
    }
    if (value && typeof value === 'object' && ('$gte' in (value as object) || '$lte' in (value as object))) {
      const range = value as { $gte?: Date; $lte?: Date }
      const at = actual instanceof Date ? actual.getTime() : 0
      if (range.$gte && at < range.$gte.getTime()) return false
      if (range.$lte && at > range.$lte.getTime()) return false
      return true
    }
    return actual === value
  })
}

/** Mock encryption: the "ciphertext" buffer is just the UTF-8 JSON itself. */
const mockEncryption: EncryptionService = {
  encrypt: async (_org: string, plaintext: Buffer) => plaintext,
  decrypt: async (_org: string, ciphertext: Buffer) => ciphertext,
  currentKeyVersion: async () => 1,
}

function makeRevision(id: string, submissionId: string, payload: Record<string, unknown>): Row {
  return {
    id,
    submissionId,
    organizationId: ORG_ID,
    revisionNumber: 1,
    data: Buffer.from(JSON.stringify(payload), 'utf8'),
    encryptionKeyVersion: 1,
    savedAt: new Date('2026-01-01T00:00:00Z'),
    savedBy: ORG_ID,
    savedByRole: 'patient',
    changeSource: 'user',
    changedFieldKeys: [],
  }
}

function makeSubmission(
  id: string,
  status: string,
  firstSavedAt: string,
  submittedAt: string | null,
  currentRevisionId: string | null,
  extra: Partial<Row> = {},
): Row {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: VERSION_ID,
    subjectType: 'patient',
    subjectId: ORG_ID,
    status,
    currentRevisionId,
    startedBy: ORG_ID,
    submittedBy: submittedAt ? ORG_ID : null,
    firstSavedAt: new Date(firstSavedAt),
    submittedAt: submittedAt ? new Date(submittedAt) : null,
    anonymizedAt: null,
    deletedAt: null,
    createdAt: new Date(firstSavedAt),
    updatedAt: new Date(firstSavedAt),
    ...extra,
  }
}

function buildService(em: StubEntityManager): AnalyticsService {
  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })
  return new AnalyticsService({
    emFactory: () => em as never,
    compiler,
    encryption: mockEncryption,
  })
}

function seedForm(em: StubEntityManager): void {
  em.seed(FormVersion, [
    {
      id: VERSION_ID,
      formId: FORM_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      versionNumber: 1,
      status: 'published',
      schema: SCHEMA,
      uiSchema: {},
      roles: ['patient'],
      schemaHash: 'hash',
      registryVersion: 'v1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ])
}

describe('AnalyticsService.computeFormAnalytics', () => {
  test('funnel + completion rate over a mixed cohort', async () => {
    const em = new StubEntityManager()
    seedForm(em)
    em.seed(FormSubmission, [
      makeSubmission('s1', 'submitted', '2026-01-01T08:00:00Z', '2026-01-01T08:10:00Z', 'r1'),
      makeSubmission('s2', 'submitted', '2026-01-02T08:00:00Z', '2026-01-02T08:30:00Z', 'r2'),
      makeSubmission('s3', 'draft', '2026-01-03T08:00:00Z', null, 'r3'),
      makeSubmission('s4', 'draft', '2026-01-03T09:00:00Z', null, 'r4'),
    ])
    em.seed(FormSubmissionRevision, [
      makeRevision('r1', 's1', { rating: 'good', agree: true, diagnosis: 'flu' }),
      makeRevision('r2', 's2', { rating: 'bad', agree: false, comments: 'free text here' }),
      makeRevision('r3', 's3', { rating: 'good' }),
      makeRevision('r4', 's4', { rating: 'good', comments: 'reached section b' }),
    ])

    const analytics = await buildService(em).computeFormAnalytics({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formId: FORM_ID,
    })

    expect(analytics.funnel.started).toBe(4)
    expect(analytics.funnel.submitted).toBe(2)
    expect(analytics.funnel.completionRate).toBe(0.5)
    expect(analytics.funnel.byStatus.draft).toBe(2)
    expect(analytics.funnel.byStatus.submitted).toBe(2)
    expect(analytics.scan.scanned).toBe(4)
    expect(analytics.scan.capped).toBe(false)
  })

  test('per-field choice tally excludes sensitive + free-text fields', async () => {
    const em = new StubEntityManager()
    seedForm(em)
    em.seed(FormSubmission, [
      makeSubmission('s1', 'submitted', '2026-01-01T08:00:00Z', '2026-01-01T08:10:00Z', 'r1'),
      makeSubmission('s2', 'submitted', '2026-01-02T08:00:00Z', '2026-01-02T08:30:00Z', 'r2'),
      makeSubmission('s3', 'submitted', '2026-01-03T08:00:00Z', '2026-01-03T08:30:00Z', 'r3'),
    ])
    em.seed(FormSubmissionRevision, [
      makeRevision('r1', 's1', { rating: 'good', agree: true, diagnosis: 'flu', comments: 'a' }),
      makeRevision('r2', 's2', { rating: 'good', agree: false, diagnosis: 'cold' }),
      makeRevision('r3', 's3', { rating: 'bad', diagnosis: 'flu' }),
    ])

    const analytics = await buildService(em).computeFormAnalytics({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formId: FORM_ID,
    })

    const byKey = Object.fromEntries(analytics.fields.map((f) => [f.fieldKey, f]))

    // Enumerable, non-sensitive select_one — value distribution present.
    expect(byKey.rating.choices).toEqual([
      { value: 'good', count: 2 },
      { value: 'bad', count: 1 },
    ])
    // Enumerable boolean — distribution present, answered/blank counted.
    expect(byKey.agree.choices).toEqual(
      expect.arrayContaining([
        { value: 'true', count: 1 },
        { value: 'false', count: 1 },
      ]),
    )
    expect(byKey.agree.answered).toBe(2)
    expect(byKey.agree.blank).toBe(1)

    // Sensitive select_one — NO value distribution, only answered/blank.
    expect(byKey.diagnosis.sensitive).toBe(true)
    expect(byKey.diagnosis.choices).toBeUndefined()
    expect(byKey.diagnosis.answered).toBe(3)

    // Free-text textarea — NO value distribution, only answered/blank.
    expect(byKey.comments.choices).toBeUndefined()
    expect(byKey.comments.answered).toBe(1)
    expect(byKey.comments.blank).toBe(2)
  })

  test('tenant isolation — other org sees nothing', async () => {
    const em = new StubEntityManager()
    seedForm(em)
    em.seed(FormSubmission, [
      makeSubmission('s1', 'submitted', '2026-01-01T08:00:00Z', '2026-01-01T08:10:00Z', 'r1'),
    ])
    em.seed(FormSubmissionRevision, [makeRevision('r1', 's1', { rating: 'good' })])

    const analytics = await buildService(em).computeFormAnalytics({
      organizationId: OTHER_ORG_ID,
      tenantId: TENANT_ID,
      formId: FORM_ID,
    })

    expect(analytics.funnel.started).toBe(0)
    expect(analytics.fields).toEqual([])
  })

  test('drop-off tracks furthest section reached by drafts', async () => {
    const em = new StubEntityManager()
    seedForm(em)
    em.seed(FormSubmission, [
      makeSubmission('s1', 'draft', '2026-01-03T08:00:00Z', null, 'r1'),
      makeSubmission('s2', 'draft', '2026-01-03T09:00:00Z', null, 'r2'),
    ])
    em.seed(FormSubmissionRevision, [
      // Only section A answered.
      makeRevision('r1', 's1', { rating: 'good' }),
      // Reached section B (comments answered).
      makeRevision('r2', 's2', { rating: 'good', comments: 'reached b' }),
    ])

    const analytics = await buildService(em).computeFormAnalytics({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formId: FORM_ID,
    })

    const byKey = Object.fromEntries(analytics.dropOff.map((d) => [d.sectionKey, d.count]))
    expect(byKey.sec_a).toBe(1)
    expect(byKey.sec_b).toBe(1)
  })
})

describe('AnalyticsService pure builders', () => {
  test('buildFunnel completion rate is zero when nothing started', () => {
    const funnel = buildFunnel([])
    expect(funnel.started).toBe(0)
    expect(funnel.completionRate).toBe(0)
  })

  test('buildTimeToComplete computes median + average from submitted only', () => {
    const submissions = [
      makeSubmission('s1', 'submitted', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'r1'), // 60s
      makeSubmission('s2', 'submitted', '2026-01-01T00:00:00Z', '2026-01-01T00:03:00Z', 'r2'), // 180s
      makeSubmission('s3', 'submitted', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', 'r3'), // 300s
      makeSubmission('s4', 'draft', '2026-01-01T00:00:00Z', null, 'r4'), // ignored
    ] as unknown as FormSubmission[]
    const ttc = buildTimeToComplete(submissions)
    expect(ttc.sampleSize).toBe(3)
    expect(ttc.medianSeconds).toBe(180)
    expect(ttc.averageSeconds).toBe(180)
  })

  test('buildVolume buckets by UTC day', () => {
    const submissions = [
      makeSubmission('s1', 'submitted', '2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z', 'r1'),
      makeSubmission('s2', 'draft', '2026-01-01T10:00:00Z', null, 'r2'),
      makeSubmission('s3', 'submitted', '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z', 'r3'),
    ] as unknown as FormSubmission[]
    const volume = buildVolume(submissions)
    const byDate = Object.fromEntries(volume.map((p) => [p.date, p]))
    expect(byDate['2026-01-01'].started).toBe(2)
    expect(byDate['2026-01-01'].submitted).toBe(1)
    expect(byDate['2026-01-02'].started).toBe(1)
    expect(byDate['2026-01-02'].submitted).toBe(1)
  })

  test('furthestSectionReached returns the last section with an answer', () => {
    const sections = [
      { key: 'sec_a', fieldKeys: ['rating'] },
      { key: 'sec_b', fieldKeys: ['comments'] },
    ]
    const fieldIndex = {
      rating: { key: 'rating' },
      comments: { key: 'comments' },
    } as never
    expect(furthestSectionReached(sections, fieldIndex, { rating: 'good' })).toBe('sec_a')
    expect(furthestSectionReached(sections, fieldIndex, { rating: 'good', comments: 'x' })).toBe('sec_b')
    expect(furthestSectionReached(sections, fieldIndex, {})).toBeNull()
  })
})
