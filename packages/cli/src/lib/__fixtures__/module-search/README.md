# module search fixtures

Generated from the test fixture of the Open Mercato Modules catalog (8 real entries and 3 core modules, data read on
2026-10-23), with the catalog's own emitter and MCP handlers and the site set to `https://modules.openmercato.com`.

- `modules-index.json`: the published `/modules.json`.
- `built-in.json`: the published `/built-in.json`.
- `catalog-parity.json`: what the catalog's `search_modules` and `get_module` tools (contract `tools@1`) answer on
  the same data. `search` and `info` hold the golden queries of the catalog spec (Appendix B), filter cases and
  cases for the search of 25 Oct (stop words, filters without a query, the typo retry). `variants` holds the same
  tools on a patched copy of the data: `patch` adds `dataAsOf.source`, preset lists, `ships` and `isolation` to
  some entries, which the plain fixture does not have. `module-search.test.ts` applies the same patch and checks that
  `yarn mercato module search|info` produce the same ranking, cards and lookups.

The data predates the catalog's move of partner modules to `community`, so `@fastwhitecat/integration-ksef-direct` is
`3rd-party` here while the live catalog lists it as `community`; the tests keep it to cover the third-party label.

## How the goldens were produced

Outputs of `catalog-parity.json` come from open-mercato/modules at commit
`587b293aafc4782c39f3f1b10623c2d2d1cd92c5` (2026-10-26), `mcp/handlers.ts` `runTool` with `now` from the file. Inputs
(`input`, `ref`, `patch`) are written by hand; the script below rewrites every output. Do not edit outputs by hand.

1. Clone open-mercato/modules, check out the commit above, run `yarn install` (Node 24).
2. Save the script below as `gen-parity.ts` in the clone and run `node gen-parity.ts <this directory>`.
3. Run `yarn jest --config jest.config.cjs src/lib/__tests__/module-search.test.ts` in `packages/cli`.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { runTool } from './mcp/handlers.ts'
import { createCatalogSource } from './mcp/index-cache.ts'

type Patch = {
  dataAsOf?: Record<string, unknown>
  entries?: Record<string, { compat?: Record<string, unknown> }>
  builtIn?: Record<string, Record<string, unknown>>
}
type Cases = { search: { input: unknown }[]; info: { ref: string }[] }

const dir = process.argv[2] as string
const file = path.join(dir, 'catalog-parity.json')
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
const parity = JSON.parse(fs.readFileSync(file, 'utf8'))
const SITE = 'https://modules.openmercato.com'

function applyPatch(index: any, builtIn: any, patch: Patch) {
  if (patch.dataAsOf) index.dataAsOf = { ...index.dataAsOf, ...patch.dataAsOf }
  for (const entry of index.entries) {
    const compat = patch.entries?.[entry.locator]?.compat
    if (compat) entry.compat = { ...entry.compat, ...compat }
  }
  builtIn.modules = builtIn.modules.map((m: any) => ({ ...m, ...(patch.builtIn?.[m.id] ?? {}) }))
}

async function run(cases: Cases, patch: Patch | null) {
  const index = read('modules-index.json')
  const builtIn = read('built-in.json')
  if (patch) applyPatch(index, builtIn, patch)
  const files: Record<string, string> = { 'modules.json': JSON.stringify(index), 'built-in.json': JSON.stringify(builtIn) }
  const fetch = async (input: string) => {
    const body = files[decodeURIComponent(input.slice(SITE.length + 1))]
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 })
  }
  const src = createCatalogSource({ indexUrl: `${SITE}/modules.json`, fetch })
  const search = []
  for (const { input } of cases.search) {
    const r = await runTool('search_modules', input, src, parity.now)
    if (!r.ok) throw new Error(`${JSON.stringify(input)}: ${r.error}`)
    search.push({ input, output: r.value })
  }
  const info = []
  for (const { ref } of cases.info) {
    const r = await runTool('get_module', { ref }, src, parity.now)
    if (!r.ok) info.push({ ref, ok: false, error: r.error, candidates: r.candidates })
    else {
      const v = r.value
      info.push({ ref, ok: true, locator: v.entry?.locator ?? null, candidates: v.candidates, warnings: v.warnings, card: v.card })
    }
  }
  return { search, info }
}

const out: Record<string, unknown> = { now: parity.now, ...(await run(parity, null)) }
if (parity.variants) {
  out.variants = []
  for (const variant of parity.variants) {
    ;(out.variants as unknown[]).push({ name: variant.name, patch: variant.patch, ...(await run(variant, variant.patch)) })
  }
}
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
```
