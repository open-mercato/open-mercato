/**
 * @jest-environment jsdom
 */
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyKpiBar } from '../CompanyKpiBar'
import type { CompanyOverview } from '../../formConfig'

// Regression for #7485: the grid stretched each tile wrapper to the row height, but the
// bordered card inside sized itself to its own content, so a tile with a trend caption
// stood taller than its neighbours. The card now fills its wrapper; the browser geometry
// is checked by TC-CRM-7485, this pins the layout contract jsdom can see.

const OVERVIEW: CompanyOverview = {
  company: { id: 'company-1', displayName: 'Acme Corp' },
  profile: null,
  customFields: {},
  tags: [],
  comments: [],
  activities: [],
  interactions: [],
  deals: [
    {
      id: 'deal-open',
      title: 'Still negotiating',
      status: 'negotiations',
      valueAmount: 1000,
      valueCurrency: 'PLN',
      createdAt: new Date().toISOString(),
    },
  ],
  todos: [],
  people: [],
}

describe('CompanyKpiBar layout (#7485)', () => {
  it('lets every card fill its grid cell so tiles in a row share the same outline', () => {
    renderWithProviders(<CompanyKpiBar data={OVERVIEW} />, { locale: 'en-US' })
    const tiles = screen.getAllByTestId('company-kpi-tile')
    expect(tiles).toHaveLength(4)
    for (const tile of tiles) {
      expect(tile.className).toMatch(/\bflex\b/)
      const card = tile.querySelector('div.rounded-lg.border')
      expect(card?.className).toMatch(/\bw-full\b/)
    }
  })
})
