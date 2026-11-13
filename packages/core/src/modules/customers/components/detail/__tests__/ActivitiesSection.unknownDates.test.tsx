/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesSection } from '../ActivitiesSection'
import type { InteractionSummary } from '../types'
import en from '../../../i18n/en.json'
import pl from '../../../i18n/pl.json'

const readApiMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (url: string) => readApiMock(url),
  apiCallOrThrow: jest.fn(),
}))
jest.mock('../AiActionChips', () => ({ AiActionChips: () => null }))
jest.mock('../ActivityTimelineFilters', () => ({
  ActivityTimelineFilters: ({ onDateToChange }: { onDateToChange: (value: string) => void }) => (
    <button onClick={() => onDateToChange('2020-12-31')}>Filter to 2020</button>
  ),
}))

function interaction(id: string, occurredAt: string | null, overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id, title: id, interactionType: 'call', body: null, status: 'done', occurredAt,
    scheduledAt: null, priority: null, authorUserId: null, ownerUserId: null,
    appearanceIcon: null, appearanceColor: null, source: 'import', entityId: 'person-1',
    dealId: null, organizationId: 'org-1', tenantId: 'tenant-1', authorName: null,
    authorEmail: null, dealTitle: null, customValues: null,
    createdAt: '2035-01-01T12:00:00.000Z', updatedAt: '2035-01-01T12:00:00.000Z',
    ...overrides,
  }
}

const mixed = [
  interaction('undated-a', null),
  interaction('older', '2020-01-02T12:00:00.000Z'),
  interaction('undated-z', null, { occurredAt: undefined, scheduledAt: undefined, createdAt: '2010-01-01T12:00:00.000Z' }),
  interaction('newer-a', '2020-02-02T12:00:00.000Z'),
  interaction('newer-z', '2020-02-02T12:00:00.000Z'),
]

beforeEach(() => {
  readApiMock.mockReset()
  readApiMock.mockImplementation(async (url: string) => ({ items: url.startsWith('/api/customers/interactions?') ? mixed : [] }))
})

it.each(['person-1', 'company-1'])('renders unknown dates last with id ties for %s and preserves creation metadata', async (entityId) => {
  const onEdit = jest.fn()
  renderWithProviders(<ActivitiesSection entityId={entityId} useCanonicalInteractions addActionLabel="Add" emptyState={{ title: 'Empty' }} onEditActivity={onEdit} />, { locale: 'en', dict: en })
  await waitFor(() => expect(screen.getAllByText('Unknown date')).toHaveLength(2))
  const rows = screen.getAllByRole('button').filter((row) => mixed.some((item) => row.textContent?.includes(item.id)))
  expect(rows.map((row) => mixed.find((item) => row.textContent?.includes(item.id))?.id)).toEqual(['newer-z', 'newer-a', 'older', 'undated-z', 'undated-a'])
  expect(screen.queryByText('2035')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('undated-a'))
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: null, createdAt: '2035-01-01T12:00:00.000Z', source: 'import' }))
  expect(new URL(readApiMock.mock.calls[0][0], 'http://localhost').searchParams.get('entityId')).toBe(entityId)
})

it('translates the unknown date and does not render creation time as a date or year', async () => {
  readApiMock.mockResolvedValue({ items: [mixed[0]] })
  renderWithProviders(<ActivitiesSection entityId="person-1" useCanonicalInteractions addActionLabel="Add" emptyState={{ title: 'Empty' }} />, { locale: 'pl', dict: pl })
  expect(await screen.findByText('Nieznana data')).toBeInTheDocument()
  expect(screen.queryByText('2035')).not.toBeInTheDocument()
})

it('keeps upcoming scheduled entries first and orders equal schedules deterministically', async () => {
  readApiMock.mockResolvedValue({ items: [mixed[0], interaction('planned-z', null, { status: 'planned', scheduledAt: '2099-01-01T12:00:00.000Z' }), mixed[1], interaction('planned-a', null, { status: 'planned', scheduledAt: '2099-01-01T12:00:00.000Z' })] })
  const onEdit = jest.fn()
  renderWithProviders(<ActivitiesSection entityId="person-1" useCanonicalInteractions addActionLabel="Add" emptyState={{ title: 'Empty' }} onEditActivity={onEdit} />)
  await screen.findByText('planned-a')
  expect(screen.getByText('planned-a').compareDocumentPosition(screen.getByText('planned-z')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('planned-z').compareDocumentPosition(screen.getByText('older')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('does not match undated legacy records by creation date in a date range', async () => {
  readApiMock.mockImplementation(async (url: string) => ({ items: url.startsWith('/api/customers/activities?') ? [
    { id: 'legacy-undated', activityType: 'call', subject: 'Legacy undated', occurredAt: null, createdAt: '2020-01-01T12:00:00.000Z' },
    { id: 'legacy-dated', activityType: 'call', subject: 'Legacy dated', occurredAt: '2020-01-01T12:00:00.000Z', createdAt: '2035-01-01T12:00:00.000Z' },
  ] : [] }))
  renderWithProviders(<ActivitiesSection entityId="person-1" addActionLabel="Add" emptyState={{ title: 'Empty' }} />)
  await screen.findByText('Legacy undated')
  fireEvent.click(screen.getByRole('button', { name: 'Filter to 2020' }))
  await waitFor(() => expect(screen.queryByText('Legacy undated')).not.toBeInTheDocument())
  expect(screen.getByText('Legacy dated')).toBeInTheDocument()
})
