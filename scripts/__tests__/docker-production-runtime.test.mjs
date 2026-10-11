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
