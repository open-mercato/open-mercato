/** @jest-environment node */

import path from 'path'
import fs from 'fs'

const moduleDir = path.join(__dirname, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(moduleDir, relativePath), 'utf8')
}

const HARDCODED_STATUS_COLOR = /\b(?:text|bg|border)-(?:green|red|amber|yellow|emerald|rose)-\d{2,3}\b/

const usersPage = 'backend/customer_accounts/users/page.tsx'
const roleDetailPage = 'backend/customer_accounts/roles/[id]/page.tsx'
const accountStatusWidget = 'widgets/injection/account-status/widget.client.tsx'
const companyUsersWidget = 'widgets/injection/company-users/widget.client.tsx'

describe('customer_accounts UI contract cleanup (regression for issue #3199)', () => {
  it('role selection chips use the shared Button primitive instead of raw <button>', () => {
    const source = readSource(usersPage)
    expect(source).not.toMatch(/<button\b/)
    expect(source).toContain("import { Button } from '@open-mercato/ui/primitives/button'")
  })

  it('role permission editor uses the shared Checkbox primitive instead of raw checkbox inputs', () => {
    const source = readSource(roleDetailPage)
    expect(source).not.toMatch(/type=["']checkbox["']/)
    expect(source).toContain("import { Checkbox } from '@open-mercato/ui/primitives/checkbox'")
  })

  it('account-status widget uses DS status tokens instead of hardcoded green/red classes', () => {
    const source = readSource(accountStatusWidget)
    expect(source).not.toMatch(HARDCODED_STATUS_COLOR)
    expect(source).toContain("import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'")
  })

  it('company-users widget uses DS status tokens instead of hardcoded green/red classes', () => {
    const source = readSource(companyUsersWidget)
    expect(source).not.toMatch(HARDCODED_STATUS_COLOR)
    expect(source).toContain("import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'")
  })
})
