"use client"

import { useMemo } from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function useOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

const DEMO_CREDENTIALS = [
  { email: 'alice.johnson@example.com', password: 'Password123!', role: 'Portal Admin' },
  { email: 'bob.smith@example.com', password: 'Password123!', role: 'Buyer' },
  { email: 'carol.white@example.com', password: 'Password123!', role: 'Viewer' },
] as const

export default function CustomerAccountsSettingsPage() {
  const t = useT()
  const origin = useOrigin()

  const portalUrl = useMemo(() => `${origin}/[org-slug]/portal`, [origin])

  return (
    <Page>
      <div className="px-3 py-3 md:px-6 md:py-4">
        <FormHeader
          mode="detail"
          title={t('customer_accounts.settings.title', 'Portal Settings')}
          backHref="/backend/customer_accounts/users"
          backLabel={t('customer_accounts.settings.back', 'Users')}
        />
      </div>

      <PageBody>
        <div className="max-w-2xl space-y-6">
          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">
              {t('customer_accounts.settings.portal_access.title', 'Portal Access')}
            </h3>
            <div>
              <p className="text-sm text-muted-foreground">
                {t('customer_accounts.settings.portal_access.url_label', 'Portal URL pattern:')}
              </p>
              <code className="mt-1 block rounded bg-muted px-3 py-2 text-sm font-mono">
                {portalUrl}
              </code>
            </div>
            <div>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={`${origin}/portal`} target="_blank" rel="noopener noreferrer">
                  {t('customer_accounts.settings.portal_access.open_portal', 'Open Portal')}
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'customer_accounts.settings.portal_access.slug_note',
                'The organization slug is auto-generated from the organization name. You can view and manage organizations in Directory \u2192 Organizations.',
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              <Link href="/backend/directory/organizations" className="text-primary underline underline-offset-4 hover:text-primary/80">
                {t('customer_accounts.settings.portal_access.manage_orgs', 'Manage Organizations')}
              </Link>
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">
              {t('customer_accounts.settings.demo_credentials.title', 'Demo Credentials')}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      {t('customer_accounts.settings.demo_credentials.email', 'Email')}
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      {t('customer_accounts.settings.demo_credentials.password', 'Password')}
                    </th>
                    <th className="pb-2 font-medium text-muted-foreground">
                      {t('customer_accounts.settings.demo_credentials.role', 'Role')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_CREDENTIALS.map((cred) => (
                    <tr key={cred.email} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{cred.email}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{cred.password}</td>
                      <td className="py-2 text-xs">{cred.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'customer_accounts.settings.demo_credentials.note',
                'These credentials are only available if example data was seeded during setup.',
              )}
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">
              {t('customer_accounts.settings.quick_links.title', 'Quick Links')}
            </h3>
            <ul className="space-y-2">
              <li>
                <Link href="/backend/customer_accounts/users" className="text-sm text-primary underline underline-offset-4 hover:text-primary/80">
                  {t('customer_accounts.settings.quick_links.manage_users', 'Manage customer users')}
                </Link>
              </li>
              <li>
                <Link href="/backend/customer_accounts/roles" className="text-sm text-primary underline underline-offset-4 hover:text-primary/80">
                  {t('customer_accounts.settings.quick_links.manage_roles', 'Manage customer roles')}
                </Link>
              </li>
              <li>
                <a
                  href="https://docs.open-mercato.com/framework/modules/customer-portal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
                >
                  {t('customer_accounts.settings.quick_links.portal_docs', 'Portal documentation')}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
