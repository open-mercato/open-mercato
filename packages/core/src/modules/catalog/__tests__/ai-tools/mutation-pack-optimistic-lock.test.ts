const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
  loadCustomFieldDefinitionIndex: jest.fn(),
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => {
  const actual = jest.requireActual('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner')
  return {
    ...actual,
    createAiApiOperationRunner: (...args: unknown[]) => createRunnerMock(...args),
  }
})

import mutationAiTools from '../../ai-tools/mutation-pack'

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VERSION_A = '2026-10-13T10:00:00.000Z'

function findTool(name: string) {
  const tool = mutationAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function product(id: string, title = 'Widget') {
  return {
    id,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    title,
    subtitle: null,
    description: 'A widget.',
    sku: `SKU-${id.slice(0, 4)}`,
    handle: null,
    isActive: true,
    primaryCurrencyCode: 'USD',
    updatedAt: new Date(VERSION_A),
  }
}

function makeCtx(expectedRecordVersions?: Record<string, string>) {
  const em = { flush: jest.fn().mockResolvedValue(undefined) }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: { resolve: jest.fn((name: string) => (name === 'em' ? em : undefined)) } as never,
    userFeatures: ['catalog.products.manage'],
    isSuperAdmin: false,
    approvedPendingActionId: 'pa-1',
    ...(expectedRecordVersions ? { expectedRecordVersions } : {}),
  }
}

describe('catalog AI writes assert the version captured at preview', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('bulk_update_products sends the per-row header only for rows with a captured version', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(product(PRODUCT_A))
      .mockResolvedValueOnce(product(PRODUCT_A, 'AI A'))
      .mockResolvedValueOnce(product(PRODUCT_B))
      .mockResolvedValueOnce(product(PRODUCT_B, 'AI B'))
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })

    await findTool('catalog.bulk_update_products').handler(
      {
        records: [
          { recordId: PRODUCT_A, title: 'AI A' },
          { recordId: PRODUCT_B, title: 'AI B' },
        ],
      } as never,
      makeCtx({ [PRODUCT_A]: VERSION_A }) as never,
    )

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(runMock.mock.calls[0][0]).toMatchObject({
      method: 'PUT',
      path: '/catalog/products',
      expectedUpdatedAt: VERSION_A,
    })
    expect(runMock.mock.calls[1][0].expectedUpdatedAt).toBeNull()
  })

  it('update_product sends the captured version for its target record', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(product(PRODUCT_A))
      .mockResolvedValueOnce(product(PRODUCT_A, 'AI A'))
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })

    await findTool('catalog.update_product').handler(
      { productId: PRODUCT_A, title: 'AI A' } as never,
      makeCtx({ [PRODUCT_A]: VERSION_A }) as never,
    )

    expect(runMock.mock.calls[0][0]).toMatchObject({ expectedUpdatedAt: VERSION_A })
  })

  it('update_product rejects a guard 409 with the optimistic_lock_conflict code', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(product(PRODUCT_A))
    runMock.mockResolvedValueOnce({
      success: false,
      statusCode: 409,
      error: 'record_modified',
      details: { code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-13T10:05:00.000Z', expectedUpdatedAt: VERSION_A },
    })

    await expect(
      findTool('catalog.update_product').handler(
        { productId: PRODUCT_A, title: 'AI A' } as never,
        makeCtx({ [PRODUCT_A]: VERSION_A }) as never,
      ),
    ).rejects.toMatchObject({ message: 'record_modified', code: 'optimistic_lock_conflict' })
  })

  it('apply_attribute_extraction sends the per-row expected version', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(product(PRODUCT_A))
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })

    await findTool('catalog.apply_attribute_extraction').handler(
      { records: [{ recordId: PRODUCT_A, attributes: { color: 'red' } }] } as never,
      makeCtx({ [PRODUCT_A]: VERSION_A }) as never,
    )

    expect(runMock.mock.calls[0][0]).toMatchObject({ method: 'PUT', expectedUpdatedAt: VERSION_A })
  })

  it('a guard 409 becomes a failed row with optimistic_lock_conflict and is not reported as updated', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(product(PRODUCT_A))
    runMock.mockResolvedValueOnce({
      success: false,
      statusCode: 409,
      error: 'record_modified',
      details: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: '2026-10-13T10:05:00.000Z',
        expectedUpdatedAt: VERSION_A,
      },
    })

    const result = (await findTool('catalog.bulk_update_products').handler(
      { records: [{ recordId: PRODUCT_A, title: 'AI A' }] } as never,
      makeCtx({ [PRODUCT_A]: VERSION_A }) as never,
    )) as { records: unknown[]; failedRecordIds: string[] }

    expect(result.records).toEqual([
      expect.objectContaining({
        recordId: PRODUCT_A,
        status: 'failed',
        error: { code: 'optimistic_lock_conflict', message: 'record_modified' },
      }),
    ])
    expect(result.failedRecordIds).toEqual([PRODUCT_A])
  })
})
