/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ResourceDocumentsPanel, resourceHistoryQueryKeyPrefix } from '../ResourceDocumentsPanel'
import { documentHistoryQueryKey } from '../../hooks/document-queries'

const templatesListProps = jest.fn()
const historyListProps = jest.fn()

jest.mock('../TemplatesList', () => ({
  TemplatesList: (props: unknown) => {
    templatesListProps(props)
    return <div data-testid="templates" />
  },
}))
jest.mock('../HistoryList', () => ({
  HistoryList: (props: unknown) => {
    historyListProps(props)
    return <div data-testid="history" />
  },
}))

function renderPanel(client: QueryClient, props: { resourceKind: string; resourceId: string }) {
  return render(
    <QueryClientProvider client={client}>
      <ResourceDocumentsPanel {...props} />
    </QueryClientProvider>,
  )
}

describe('resourceHistoryQueryKeyPrefix', () => {
  it('contains kind and id and differs per record', () => {
    const a = resourceHistoryQueryKeyPrefix('sales.order', 'o1')
    const b = resourceHistoryQueryKeyPrefix('sales.order', 'o2')
    expect(a).toEqual(['document-generators', 'history', 'sales.order', 'o1'])
    expect(a).not.toEqual(b)
  })

  it('is a prefix of the history query key for the same resource only', () => {
    const key = documentHistoryQueryKey({ resourceKind: 'sales.order', resourceId: 'o1' })
    const prefix = resourceHistoryQueryKeyPrefix('sales.order', 'o1')
    expect(key.slice(0, prefix.length)).toEqual([...prefix])
    const other = documentHistoryQueryKey({ resourceKind: 'sales.order', resourceId: 'o2' })
    expect(other.slice(0, prefix.length)).not.toEqual([...prefix])
  })
})

describe('ResourceDocumentsPanel', () => {
  beforeEach(() => {
    templatesListProps.mockReset()
    historyListProps.mockReset()
  })

  it('renders nothing when the resource id is missing', () => {
    const client = new QueryClient()
    renderPanel(client, { resourceKind: 'sales.order', resourceId: '' })
    expect(screen.queryByTestId('templates')).toBeNull()
    expect(screen.queryByTestId('history')).toBeNull()
  })

  it('wires identity-only props into the list components', () => {
    renderPanel(new QueryClient(), { resourceKind: 'sales.quote', resourceId: 'q1' })
    expect(templatesListProps.mock.calls[0][0]).toMatchObject({
      record: { id: 'q1' },
      filter: { resourceKind: 'sales.quote' },
    })
    expect(historyListProps.mock.calls[0][0]).toMatchObject({
      resourceKind: 'sales.quote',
      resourceId: 'q1',
      pageSize: 10,
      showFilters: false,
    })
  })

  it('invalidates only the scoped history prefix after generation', () => {
    const client = new QueryClient()
    const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    renderPanel(client, { resourceKind: 'sales.order', resourceId: 'o1' })
    const { onGenerated } = templatesListProps.mock.calls[0][0] as { onGenerated: () => void }
    onGenerated()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['document-generators', 'history', 'sales.order', 'o1'] })
  })
})
