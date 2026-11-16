/** @jest-environment jsdom */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => ({
    auth: {
      user: {
        displayName: 'Profile fixture',
        email: 'profile@test.local',
        emailVerified: true,
        lastLoginAt: null,
        createdAt: '2026-01-01T12:00:00Z',
      },
      roles: [{ id: 'role-1', name: 'Buyer' }],
      resolvedFeatures: ['orders.view', 'catalog.view'],
      isPortalAdmin: false,
      loading: false,
    },
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({ InjectionSpot: () => null }))

import PortalProfilePage from '../frontend/[orgSlug]/portal/profile/page'

it.each([
  ['en', en, '1 assigned', '2 features'],
  ['pl', pl, 'Przypisane role: 1', 'Uprawnienia: 2'],
  ['de', de, '1 zugewiesen', '2 Berechtigungen'],
  ['es', es, '1 asignados', '2 permisos'],
  ['ko', ko, '할당된 역할 1개', '권한 2개'],
] as const)('renders translated role and permission counts in %s', (locale, dict, rolesHeading, featuresHeading) => {
  const { getByRole } = renderWithProviders(<PortalProfilePage params={{ orgSlug: 'acme' }} />, { locale, dict })
  expect(getByRole('heading', { name: rolesHeading })).toBeVisible()
  expect(getByRole('heading', { name: featuresHeading })).toBeVisible()
})
