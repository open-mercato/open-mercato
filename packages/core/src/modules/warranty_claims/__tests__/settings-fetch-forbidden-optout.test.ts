/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The claim detail and create pages both fetch the settings-only `settings-general`
// endpoint just to prefill a default. Employees can view/create claims but lack
// `warranty_claims.settings.manage`, so that fetch 403s. Without the opt-out header the
// shared `apiFetch` flashes a false "Access denied" banner (#5285). Guard the header so a
// refactor cannot silently reintroduce the flash — this page cannot be rendered in jsdom
// (CrudForm + DataTable + lazy AiChat), so this is a source-contract assertion.
const CALLERS = [
  '../backend/warranty_claims/[id]/page.tsx',
  '../backend/warranty_claims/create/page.tsx',
]

describe('optional settings-general fetch opts out of the forbidden flash (#5285)', () => {
  for (const rel of CALLERS) {
    it(`${rel} sends x-om-forbidden-redirect on the settings-general fetch`, () => {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      const idx = src.indexOf("apiCall")
      expect(idx).toBeGreaterThan(-1)
      const callIdx = src.indexOf("'/api/warranty_claims/settings-general'")
      expect(callIdx).toBeGreaterThan(-1)
      // The opt-out header must sit within the same apiCall invocation (next ~200 chars).
      expect(src.slice(callIdx, callIdx + 200)).toContain("'x-om-forbidden-redirect': '0'")
    })
  }
})
