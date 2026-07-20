import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Company overlay: lets an organization tailor the starter without forking it.
// Resolution order (later wins per key):
//   1. built-in defaults below
//   2. starters/company/config.mjs        (committed, per-company policy)
//   3. starters/company/config.local.mjs  (gitignored, per-machine override)
// Each file default-exports a plain object matching COMPANY_DEFAULTS' shape.

export const COMPANY_DEFAULTS = {
  name: '',
  // Where users are sent when a prerequisite needs IT. Shown verbatim in the
  // doctor's "hand this to IT" sheet.
  itContact: '',
  mirrors: {
    // e.g. https://registry.example.com/npm — applied via COREPACK_NPM_REGISTRY
    // and yarn's npmRegistryServer for installs run by the starter.
    npmRegistry: '',
    // Forwarded into image builds as the ALPINE_MIRROR build arg.
    alpineMirror: '',
    // Base URL that mirrors https://nodejs.org/dist (used by start.sh/start.ps1).
    nodeDist: '',
  },
  certs: {
    // Extra PEM bundles (absolute or repo-relative) trusted in addition to any
    // captured interception CA. Point this at the corporate root bundle when IT
    // can provide one — capture is the fallback, not the preferred source.
    bundles: [],
    // Set false to disable active TLS-interception capture (audit-sensitive
    // fleets); provisioning then relies solely on `bundles`.
    capture: true,
  },
  // Extra doctor checks: [{ id, title, run: async (ctx) => ({ level, detail, guide? }) }]
  checks: [],
  // Step tweaks for `up`: ids listed in `disable` are skipped; `extra` steps
  // (same shape as steps.mjs entries) run after the built-ins, before launch.
  steps: { disable: [], extra: [] },
  // Env defaults merged into generated .env files (never overwrite existing).
  env: {},
}

function mergeConfig(base, overlay) {
  if (!overlay || typeof overlay !== 'object') return base
  const merged = { ...base, ...overlay }
  merged.mirrors = { ...base.mirrors, ...(overlay.mirrors ?? {}) }
  merged.certs = { ...base.certs, ...(overlay.certs ?? {}) }
  merged.steps = {
    disable: [...base.steps.disable, ...(overlay.steps?.disable ?? [])],
    extra: [...base.steps.extra, ...(overlay.steps?.extra ?? [])],
  }
  merged.checks = [...base.checks, ...(overlay.checks ?? [])]
  merged.env = { ...base.env, ...(overlay.env ?? {}) }
  return merged
}

export async function loadCompanyConfig(repoRoot, { warn = console.warn } = {}) {
  let config = COMPANY_DEFAULTS
  for (const candidate of ['config.mjs', 'config.local.mjs']) {
    const filePath = path.join(repoRoot, 'starters', 'company', candidate)
    if (!fs.existsSync(filePath)) continue
    try {
      const module = await import(pathToFileURL(filePath).href)
      config = mergeConfig(config, module.default)
    } catch (error) {
      warn(`⚠️ Ignoring starters/company/${candidate} — it failed to load: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return config
}

export function resolveCompanyCertBundles(repoRoot, company) {
  const bundles = []
  for (const entry of company.certs.bundles) {
    const resolved = path.isAbsolute(entry) ? entry : path.join(repoRoot, entry)
    if (fs.existsSync(resolved)) bundles.push(resolved)
  }
  return bundles
}
