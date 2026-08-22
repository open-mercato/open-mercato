import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The standalone integration lanes serve a PRODUCTION build (`yarn start`), so
// NODE_ENV is `production` inside the server process no matter what the app .env
// says. `urlForCustomerOrg` refuses to fall back to a localhost portal URL there,
// so every customer-portal email (invitations, magic links, password resets)
// throws unless PLATFORM_PORTAL_BASE_URL is pinned — the invite routes turn that
// throw into a 502 (TC-AUTH-032, TC-AUTH-033, TC-CACC-INVITE-PERSON-001).
//
// The captured-email file has the same shape of problem: the app writes it from
// the scaffolded app's directory while the Playwright specs read it from the
// monorepo root, so an unset OM_TEST_EMAIL_CAPTURE_PATH leaves each side on a
// different default path and TC-AUTH-033 never sees the invitation email.
//
// OM_ENABLE_PUSH_STUB_ADAPTER is the same shape again. The network-free
// `push_stub` channel adapter is registered by push_notifications/di.ts only when
// the flag is set, and the ephemeral harness sets it on both the app server and
// the Playwright process. The standalone lanes originally set it on neither, so
// TC-PUSH-003 could not resolve an adapter and every delivery landed in `failed`.
//
// Every variable here must appear twice per lane: once in the standalone app's
// .env (the server process) and once in the integration-test step env (the specs
// and the queue-drain children, which do not read the app's .env).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const REQUIRED_VARIABLES = [
  'PLATFORM_PORTAL_BASE_URL',
  'OM_TEST_EMAIL_CAPTURE_PATH',
  'OM_ENABLE_PUSH_STUB_ADAPTER',
  // NEXT_PUBLIC_DOCUMENTS_COLLAB_URL is inlined into the bundle at build time, so the
  // app .env copy is what the browser sees; the test-process copy is what
  // `ensureManagedCollabSidecar` reads to decide whether to start a sidecar at all.
  // DOCUMENTS_COLLAB_JWT_SECRET_V2 has to match on both sides too: the app mints the
  // collaboration token and the sidecar verifies it. With neither configured the
  // collab-token route returns an empty token (TC-DOCUMENTS-009) and the editor stays
  // in single-user mode (TC-DOCUMENTS-013).
  'NEXT_PUBLIC_DOCUMENTS_COLLAB_URL',
  'DOCUMENTS_COLLAB_JWT_SECRET_V2',
]

const STANDALONE_LANES = [
  '.github/workflows/snapshot.yml',
  '.github/workflows/npm-snapshot-preview.yml',
  'scripts/test-create-app-integration.ts',
]

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativePath.split('/')), 'utf8')
}

function countAssignments(source: string, variable: string): number {
  const matches = source.matchAll(new RegExp(`${variable}['"]?\\s*[:=]\\s*\\S`, 'g'))
  return Array.from(matches).length
}

for (const lane of STANDALONE_LANES) {
  for (const variable of REQUIRED_VARIABLES) {
    test(`${lane} pins ${variable} for both the app and the test processes`, () => {
      const source = readRepoFile(lane)
      assert.ok(
        countAssignments(source, variable) >= 2,
        `${lane} must set ${variable} for the standalone app .env AND the integration-test env; the two run in different processes with different working directories`,
      )
    })
  }
}

test('PLATFORM_PORTAL_BASE_URL is documented for scaffolded apps', () => {
  for (const envExample of ['apps/mercato/.env.example', 'packages/create-app/template/.env.example']) {
    assert.match(
      readRepoFile(envExample),
      /PLATFORM_PORTAL_BASE_URL/,
      `${envExample} must document PLATFORM_PORTAL_BASE_URL — production deployments that omit it fail every customer-portal email`,
    )
  }
})
