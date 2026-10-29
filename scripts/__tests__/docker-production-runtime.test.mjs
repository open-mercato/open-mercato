import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8')
const runnerStage = dockerfile.slice(dockerfile.lastIndexOf('FROM node:24-alpine AS runner'))

test('production runner includes the app runtime CLI launcher', () => {
  const launcherPath = path.join(repositoryRoot, 'apps/mercato/scripts/mercato-cli.mjs')

  assert.ok(fs.existsSync(launcherPath), 'the runtime CLI launcher must exist in the app source')
  assert.match(
    runnerStage,
    /COPY --from=builder \/app\/apps\/mercato\/scripts \.\/apps\/mercato\/scripts/,
    'the production runner must copy the app scripts directory',
  )
})

for (const composeFile of [
  'starters/docker/compose.fullapp.yml',
  'starters/docker/compose.fullapp.dev.yml',
  'docker-compose.fullapp.yml',
  'docker-compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
]) {
  test(`${composeFile} leaves missing bootstrap passwords empty for CLI validation`, () => {
    const content = fs.readFileSync(path.join(repositoryRoot, composeFile), 'utf8')
    const assignments = content.match(/^\s*OM_INIT_SUPERADMIN_PASSWORD:.*$/gm) ?? []
    assert.ok(assignments.length > 0)
    for (const assignment of assignments) {
      assert.match(assignment.trim(), /^OM_INIT_SUPERADMIN_PASSWORD: \$\{OM_INIT_SUPERADMIN_PASSWORD:-\}$/)
    }
  })
}
