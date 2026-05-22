/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ChangelogFilters } from '../ChangelogFilters'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ChangelogFilters', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    })
  })

  it('supports multi-select field filters and clearing the selection', async () => {
    function Harness() {
      const [fieldNames, setFieldNames] = React.useState<string[]>([])

      return (
        <>
          <ChangelogFilters
            dateRange="90d"
            fieldNames={fieldNames}
            actorUserIds={[]}
            actionTypes={[]}
            fieldOptions={[
              { value: 'status', label: 'Status' },
              { value: 'ownerUserId', label: 'Owner' },
            ]}
            userOptions={[]}
            actionOptions={[]}
            onDateRangeChange={() => {}}
            onFieldNamesChange={setFieldNames}
            onActorUserIdsChange={() => {}}
            onActionTypesChange={() => {}}
            onExport={() => {}}
          />
          <output data-testid="selected-fields">{fieldNames.join(',')}</output>
        </>
      )
    }

    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'All fields' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Status' }))
    await waitFor(() => {
      expect(screen.getByTestId('selected-fields')).toHaveTextContent('status')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    await waitFor(() => {
      expect(screen.getByTestId('selected-fields')).toHaveTextContent('status,ownerUserId')
    })

    expect(screen.getByRole('button', { name: '2 selected' })).toBeInTheDocument()

    const resetButtons = screen.getAllByRole('button', { name: 'All fields' })
    fireEvent.click(resetButtons[resetButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByTestId('selected-fields')).toBeEmptyDOMElement()
    })
  })
})
