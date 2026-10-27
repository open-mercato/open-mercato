/** @jest-environment node */
// The denial discriminator crosses a server/client boundary: the route module is
// server-only (DI container, `next/server`), so the two project pages restate the
// literal instead of importing it. This pins them together so a rename on either
// side cannot silently turn screen 17 back into "Project not found."

import { readFileSync } from 'node:fs'
import path from 'node:path'

const MODULE_ROOT = path.resolve(__dirname, '../../../..')

const ROUTE_FILE = path.join(MODULE_ROOT, 'api/timesheets/time-projects/route.ts')
const DETAIL_PAGE = path.join(MODULE_ROOT, 'backend/staff/time-tracking/projects/[id]/page.tsx')
const EDIT_PAGE = path.join(MODULE_ROOT, 'backend/staff/time-tracking/projects/[id]/edit/page.tsx')

const readReason = (file: string, declaration: RegExp): string => {
  const source = readFileSync(file, 'utf8')
  const match = declaration.exec(source)
  if (!match) throw new Error(`[internal] no NO_PROJECT_ACCESS_REASON declaration in ${file}`)
  return match[1]
}

describe('no project access discriminator', () => {
  const routeReason = readReason(
    ROUTE_FILE,
    /export const NO_PROJECT_ACCESS_REASON = '([^']+)'/,
  )

  it('is the value the guard state keys off', () => {
    expect(routeReason).toBe('no_project_access')
  })

  it.each([
    ['detail page', DETAIL_PAGE],
    ['edit page', EDIT_PAGE],
  ])('matches the literal restated in the %s', (_label, file) => {
    expect(readReason(file, /const NO_PROJECT_ACCESS_REASON = '([^']+)'/)).toBe(routeReason)
  })

  it.each([
    ['detail page', DETAIL_PAGE],
    ['edit page', EDIT_PAGE],
  ])('renders NoProjectAccess from the %s', (_label, file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).toContain("from '")
    expect(source).toMatch(/import \{ NoProjectAccess \} from '.*time-tracking-ui\/NoProjectAccess'/)
    expect(source).toMatch(/<NoProjectAccess timeProjectId=\{projectId\} \/>/)
  })
})
