import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider, useT } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import polish from '../../i18n/pl.json'
import quickLinks from '../injection/portal-quick-links/widget'
import recentActivity from '../injection/portal-recent-activity/widget'
import accountOverview from '../injection/portal-stats/widget'

function DashboardWidgets() {
  const t = useT()
  return [quickLinks, recentActivity, accountOverview].map(({ metadata, Widget }) => (
    <section key={metadata.id}>
      <h2>{t(metadata.title)}</h2>
      {metadata.description && <p>{t(metadata.description)}</p>}
      <Widget context={{}} />
    </section>
  ))
}

describe('example portal dashboard localization', () => {
  it.each([
    ['en', english, ['Quick Links', 'View order history', 'Recent Activity', 'Logged in', '2 minutes ago', 'Account Overview', 'Awaiting shipment']],
    ['pl', polish, ['Szybkie linki', 'Wyświetl historię zamówień', 'Ostatnia aktywność', 'Zalogowano się', '2 minuty temu', 'Przegląd konta', 'Oczekują na wysyłkę']],
  ] as const)('renders widget titles and content in %s', (locale, dict, expected) => {
    const html = renderToStaticMarkup(
      <I18nProvider locale={locale} dict={dict}>
        <DashboardWidgets />
      </I18nProvider>,
    )
    for (const copy of expected) expect(html).toContain(copy)
    expect(html).not.toContain('example.portal.dashboard.')
  })
})
