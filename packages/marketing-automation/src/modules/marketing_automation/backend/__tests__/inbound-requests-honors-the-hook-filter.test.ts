import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Show what arrived" on the inbound-hooks screen links here with `?hookId=<id>` already in the URL —
 * it means ONE hook's requests, not every hook's. The inbound-requests screen used to ignore that
 * parameter entirely and always load every request from every hook: the row action's promise and the
 * screen it opened disagreed.
 *
 * A structural test, matching this module's `backend/__tests__` convention of reading page source rather
 * than rendering it — there is no jsdom-rendering precedent for a page component in this module, and the
 * defect here is which query the component builds, not a rendering concern.
 */
describe('the inbound-requests screen honors ?hookId', () => {
  const source = readFileSync(
    join(__dirname, '..', 'marketing', 'inbound-requests', 'page.tsx'),
    'utf8',
  )

  it('reads hookId from the current URL', () => {
    expect(source).toMatch(/searchParams\.get\(['"]hookId['"]\)/)
  })

  it('forwards hookId to the inbound-requests API call', () => {
    const loadFn = source.slice(source.indexOf('const load = React.useCallback'))
    expect(loadFn).toMatch(/query\.set\(['"]hookId['"],\s*hookId\)/)
    expect(loadFn).toContain('/api/marketing_automation/inbound-requests?${query.toString()}')
  })

  it('reloads when the hook filter changes', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{ void load\(\) \}, \[load, scopeVersion, hookId\]\)/)
  })
})
