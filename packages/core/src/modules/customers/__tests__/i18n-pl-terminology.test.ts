import pl from '../i18n/pl.json'

const DEAL_KEYS = [
  'customers.companies.dashboard.activeDeal',
  'customers.companies.dashboard.kpi.activeDeals',
  'customers.companies.detail.activeDeal',
  'customers.deals.detail.closeLostError',
  'customers.deals.detail.closeWonError',
  'customers.deals.detail.stageMenu.description',
  'customers.deals.detail.stageUpdateError',
  'customers.deals.detail.stageUpdateSuccess',
  'customers.deals.kanban.card.aria.menu',
  'customers.deals.kanban.card.aria.roledescription',
  'customers.deals.kanban.card.aria.select',
  'customers.deals.kanban.cta.newDeal',
  'customers.deals.kanban.cta.quickDeal',
  'customers.deals.kanban.currencyBreakdown.colDeals',
  'customers.deals.kanban.currencyBreakdown.headingCount',
  'customers.deals.kanban.currencyFilter.subtitle',
  'customers.deals.kanban.menu.open',
  'customers.deals.kanban.quickDeal.submit',
  'customers.deals.kanban.quickDeal.title',
  'customers.deals.kanban.quickDeal.title.label',
  'customers.deals.kanban.search.placeholder',
  'customers.deals.map.canvas.label',
  'customers.deals.map.loadError',
  'customers.deals.map.panel.empty.description',
  'customers.deals.map.panel.empty.title',
  'customers.deals.map.panel.hint',
  'customers.deals.map.panel.sort.label',
  'customers.deals.map.panel.title',
  'customers.deals.map.preview.openDeal',
  'customers.deals.map.truncated',
  'customers.errors.primaryPersonMustBeLinked',
  'customers.personTags.category.deal-statuses',
  'customers.tags.manage.description.customers.custom_tags',
  'customers.tags.manage.description.customers.status',
]

describe('customers pl.json deal/szansa terminology (#5156)', () => {
  it('uses "szansa" instead of the anglicism "deal" for every previously mixed key', () => {
    for (const key of DEAL_KEYS) {
      const value = (pl as Record<string, string>)[key]
      expect(value).toBeDefined()
      expect(value).not.toMatch(/deal/i)
    }
  })
})
