/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DetailTabsLayout } from '../DetailTabsLayout'

describe('DetailTabsLayout', () => {
  it('switches tabs without forcing scroll or temporary height locks', () => {
    const handleTabChange = jest.fn()
    const scrollIntoView = jest.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })

    const { container, getByRole } = renderWithProviders(
      <DetailTabsLayout
        tabs={[
          { id: 'notes', label: 'Notes' },
          { id: 'tasks', label: 'Tasks' },
        ]}
        activeTab="notes"
        onTabChange={handleTabChange}
        sectionAction={null}
        onSectionAction={() => {}}
        navAriaLabel="Customer detail sections"
      >
        <div>Tab content</div>
      </DetailTabsLayout>,
    )

    const root = container.firstElementChild as HTMLElement
    const contentWrapper = root.lastElementChild as HTMLElement

    expect(contentWrapper.getAttribute('style')).toBeNull()

    const notesTab = getByRole('tab', { name: 'Notes' })
    const tasksTab = getByRole('tab', { name: 'Tasks' })

    expect(notesTab).toHaveAttribute('type', 'button')
    expect(notesTab).toHaveAttribute('data-slot', 'tabs-trigger')
    expect(notesTab).toHaveAttribute('data-variant', 'underline')
    expect(notesTab).toHaveAttribute('data-state', 'active')
    expect(tasksTab).toHaveAttribute('type', 'button')
    expect(tasksTab).toHaveAttribute('data-state', 'inactive')

    fireEvent.click(tasksTab)

    expect(handleTabChange).toHaveBeenCalledWith('tasks')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(contentWrapper.getAttribute('style')).toBeNull()
  })
})
