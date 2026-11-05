/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (
    _headers: Record<string, string>,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

type RunMutationArgs = {
  operation: () => Promise<unknown>
  context: Record<string, unknown>
  mutationPayload?: Record<string, unknown>
}

const runMutationMock = jest.fn(async ({ operation }: RunMutationArgs) => operation())
const retryLastMutation = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation }),
}))

// Render the row actions as plain buttons so we can invoke them without
// driving the RowActions dropdown — keeps the test focused on the guarded
// mutation wiring rather than DataTable internals.
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, rowActions }: any) => (
    <div>
      {(data ?? []).map((row: any) => (
        <div key={row.entityId}>{rowActions(row)}</div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: any) => (
    <div>
      {(items ?? []).map((action: any) => (
        <button key={action.id} data-action-id={action.id} onClick={() => action.onSelect()}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

import QueryIndexesTable from '../QueryIndexesTable'

async function findActionButton(actionId: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = document.querySelector(`[data-action-id="${actionId}"]`)
    if (!button) throw new Error(`row action "${actionId}" not rendered yet`)
    return button as HTMLButtonElement
  })
}

const statusRow = {
  entityId: 'catalog:catalog_product',
  label: 'Products',
  vectorEnabled: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  runMutationMock.mockImplementation(async ({ operation }: RunMutationArgs) => operation())
  apiCallOrThrowMock.mockResolvedValue(undefined)
  readApiResultOrThrowMock.mockResolvedValue({ items: [statusRow] })
})

describe('QueryIndexesTable guarded mutations', () => {
  it('runs the reindex row action through the guarded mutation pipeline', async () => {
    renderWithProviders(<QueryIndexesTable />)

    const reindexButton = await findActionButton('reindex')

    fireEvent.click(reindexButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    const call = runMutationMock.mock.calls[0][0] as RunMutationArgs
    expect(call.context).toEqual(
      expect.objectContaining({
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        retryLastMutation,
      }),
    )

    await waitFor(() =>
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/query_index/reindex',
        expect.objectContaining({ method: 'POST' }),
        expect.anything(),
      ),
    )
  })

  it('runs the purge row action through the guarded mutation pipeline', async () => {
    renderWithProviders(<QueryIndexesTable />)

    const purgeButton = await findActionButton('purge')

    fireEvent.click(purgeButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    const call = runMutationMock.mock.calls[0][0] as RunMutationArgs
    expect(call.context).toEqual(
      expect.objectContaining({
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        retryLastMutation,
      }),
    )

    await waitFor(() =>
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/query_index/purge',
        expect.objectContaining({ method: 'POST' }),
        expect.anything(),
      ),
    )
  })

  it('routes the vector and fulltext reindex actions through guarded mutations', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: [{ ...statusRow, vectorEnabled: true, fulltextEnabled: true }],
    })

    renderWithProviders(<QueryIndexesTable />)

    fireEvent.click(await findActionButton('vector-reindex'))
    await waitFor(() =>
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/search/embeddings/reindex',
        expect.objectContaining({ method: 'POST' }),
        expect.anything(),
      ),
    )
    expect(runMutationMock.mock.calls.at(-1)?.[0].context).toEqual(
      expect.objectContaining({ resourceKind: 'query_index.vector', retryLastMutation }),
    )

    fireEvent.click(await findActionButton('fulltext-reindex'))
    await waitFor(() =>
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/search/reindex',
        expect.objectContaining({ method: 'POST' }),
        expect.anything(),
      ),
    )
    expect(runMutationMock.mock.calls.at(-1)?.[0].context).toEqual(
      expect.objectContaining({ resourceKind: 'query_index.fulltext', retryLastMutation }),
    )
  })
})
