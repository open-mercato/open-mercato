/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FilterBar } from '../FilterBar'

describe('FilterBar accessibility', () => {
  it('labels the search field with its translated placeholder', () => {
    render(
      <I18nProvider locale="en" dict={{}}>
        <FilterBar
          searchValue=""
          onSearchChange={() => {}}
          searchPlaceholder="Search evidence submissions"
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('searchbox', { name: 'Search evidence submissions' })).toBeInTheDocument()
  })
})
