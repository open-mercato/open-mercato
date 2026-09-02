import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Every full-app stack whose app service bootstraps a tenant. Unlike the JWT/NODE_ENV guards in
// fullapp-compose-auth-defaults.test.mjs, the `.dev.yml` siblings are included here: a development
// stack seeds the same demo accounts through the same `setupInitialTenant()` path, so an operator
// who configures the account domain expects it to be honored there too.
const COMPOSE_FILES = [
  'docker-compose.fullapp.yml',
  'docker-compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
]

// Docker Compose's `environment:` block is an allowlist, not a passthrough: a variable only reaches
// the container when it is declared there. `setupInitialTenant()`
// (packages/core/src/modules/auth/lib/setup-app.ts) reads all of these, and silently falls back to
// its hardcoded `acme.com` domain for any email it cannot see — so declaring the superadmin pair
// without the derived-account pairs produces a stack that half-honors the operator's configuration.
const REQUIRED_INIT_VARIABLES = [
  'OM_INIT_ADMIN_EMAIL',
  'OM_INIT_ADMIN_PASSWORD',
  'OM_INIT_EMPLOYEE_EMAIL',
  'OM_INIT_EMPLOYEE_PASSWORD',
]

// The marker that identifies a tenant-seeding service. Keying on the password rather than the email
// is deliberate: the `mcp` service declares OM_INIT_SUPERADMIN_EMAIL to resolve the superadmin who
// owns its API key, but seeds no users and needs none of the variables above.
const SEEDING_SERVICE_MARKER = 'OM_INIT_SUPERADMIN_PASSWORD'

function readServices(relPath) {
  const content = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
  const servicesStart = content.indexOf('\nservices:')
  assert.notStrictEqual(servicesStart, -1, `${relPath} must define a services block`)

  const afterServices = content.slice(servicesStart + '\nservices:'.length)
  const endOfServices = afterServices.search(/^[A-Za-z]/m)
  const body = endOfServices === -1 ? afterServices : afterServices.slice(0, endOfServices)

  const services = []
  const headings = [...body.matchAll(/^ {2}([A-Za-z0-9_.-]+):\s*$/gm)]
  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length
    const end = index + 1 < headings.length ? headings[index + 1].index : body.length
    services.push({ name: heading[1], block: body.slice(start, end) })
  }

  assert.ok(services.length > 0, `${relPath} must define at least one service`)
  return services
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} passes every init account variable into the seeding service`, () => {
    const seedingServices = readServices(relPath).filter((service) =>
      new RegExp(`^\\s+${SEEDING_SERVICE_MARKER}:`, 'm').test(service.block),
    )

    assert.ok(
      seedingServices.length > 0,
      `${relPath} declares no ${SEEDING_SERVICE_MARKER}, so this guard would pass vacuously. If the `
      + 'bootstrap moved, point the guard at whatever marks the seeding service now.',
    )

    for (const service of seedingServices) {
      for (const variable of REQUIRED_INIT_VARIABLES) {
        assert.match(
          service.block,
          new RegExp(`^\\s+${variable}:\\s+\\$\\{${variable}(?=[:}])`, 'm'),
          `${relPath} service "${service.name}" declares ${SEEDING_SERVICE_MARKER} but not `
          + `${variable}, so an operator who sets ${variable} on the host never reaches the `
          + `container and setupInitialTenant() seeds the hardcoded acme.com default instead.`,
        )
      }
    }
  })
}
