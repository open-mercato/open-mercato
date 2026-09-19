/** @jest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { features } from '../acl'
import { setup } from '../setup'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import DashboardPage from '../backend/logistics/page'
import { metadata as dashboardMetadata } from '../backend/logistics/page.meta'
import transportJobsPage from '../backend/logistics/transport-jobs/page'
import { metadata as transportJobsMetadata } from '../backend/logistics/transport-jobs/page.meta'
import fleetPage from '../backend/logistics/fleet/page'
import { metadata as fleetMetadata } from '../backend/logistics/fleet/page.meta'
import tripsPage from '../backend/logistics/trips/page'
import { metadata as tripsMetadata } from '../backend/logistics/trips/page.meta'
import mapPage from '../backend/logistics/map/page'
import { metadata as mapMetadata } from '../backend/logistics/map/page.meta'
import statisticsPage from '../backend/logistics/statistics/page'
import { metadata as statisticsMetadata } from '../backend/logistics/statistics/page.meta'
import proposalsDisruptionsPage from '../backend/logistics/proposals-disruptions/page'
import { metadata as proposalsDisruptionsMetadata } from '../backend/logistics/proposals-disruptions/page.meta'

const pages = [
  { id: 'dashboard', path: '/backend/logistics', Component: DashboardPage, metadata: dashboardMetadata },
  { id: 'transportJobs', path: '/backend/logistics/transport-jobs', Component: transportJobsPage, metadata: transportJobsMetadata },
  { id: 'fleet', path: '/backend/logistics/fleet', Component: fleetPage, metadata: fleetMetadata },
  { id: 'trips', path: '/backend/logistics/trips', Component: tripsPage, metadata: tripsMetadata },
  { id: 'map', path: '/backend/logistics/map', Component: mapPage, metadata: mapMetadata },
  { id: 'statistics', path: '/backend/logistics/statistics', Component: statisticsPage, metadata: statisticsMetadata },
  { id: 'proposalsDisruptions', path: '/backend/logistics/proposals-disruptions', Component: proposalsDisruptionsPage, metadata: proposalsDisruptionsMetadata },
] as const

const dictionaries: Record<string, Record<string, string>> = { en, pl, de, es, ko }

describe('Logistics navigation foundation', () => {
  test.each(pages)('$path is individually protected by the read feature', ({ metadata }) => {
    expect(metadata.requireAuth).toBe(true)
    expect(metadata.requireFeatures).toEqual(['logistics.view'])
    expect(metadata.pageGroupKey).toBe('logistics.nav.group')
  })

  test('declares only read access and grants it to administrators by default', () => {
    expect(features.map((feature) => feature.id)).toEqual(['logistics.view'])
    expect(setup.defaultRoleFeatures).toEqual({ admin: ['logistics.view'] })
    expect(pages.map((page) => page.metadata.pageOrder)).toEqual([10, 20, 30, 40, 50, 60, 70])
  })

  describe.each(['en', 'pl', 'de', 'es', 'ko'] as const)('%s locale', (locale) => {
    const dict = dictionaries[locale]
    test.each(pages)('$path displays its translated purpose and honest availability', ({ id, Component }) => {
      const { container } = render(
        <I18nProvider locale={locale} dict={dict}>
          <Component />
        </I18nProvider>,
      )

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dict[`logistics.${id}.title`])
      expect(screen.getByText(dict[`logistics.${id}.description`])).toBeVisible()
      expect(screen.getByText(dict['logistics.planned.title'])).toBeVisible()
      expect(screen.getByText(dict['logistics.planned.description'])).toBeVisible()
      expect(container.querySelector('form, table, input, button, canvas, iframe')).toBeNull()
      expect(container.textContent).not.toMatch(/logistics\.[a-zA-Z.]+/)

      if (id !== 'dashboard') {
        expect(screen.getByRole('link', { name: dict['logistics.back'] })).toHaveAttribute('href', '/backend/logistics')
      }
    })

    test('dashboard links reach all six sections in specification order', () => {
      render(
        <I18nProvider locale={locale} dict={dict}>
          <DashboardPage />
        </I18nProvider>,
      )
      const links = within(screen.getByRole('navigation', { name: dict['logistics.sections.title'] })).getAllByRole('link')
      expect(links.map((link) => link.getAttribute('href'))).toEqual(pages.slice(1).map((page) => page.path))
      expect(links.map((link) => link.textContent)).toEqual(pages.slice(1).map((page) => dict[`logistics.${page.id}.title`]))
    })
  })
})
