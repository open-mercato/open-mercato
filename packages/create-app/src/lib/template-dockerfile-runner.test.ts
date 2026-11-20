import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dockerfile = readFileSync(new URL('../../template/Dockerfile', import.meta.url), 'utf-8')
const runnerStage = dockerfile.slice(dockerfile.indexOf('AS runner'))

test('runner stage does not recursively chown /app (it duplicates every file into a new layer)', () => {
  assert.doesNotMatch(runnerStage, /chown\s+-R\s+\S+\s+\/app(\s|$)/)
})

test('runner stage copies .mercato once, owned by the runtime user', () => {
  assert.doesNotMatch(runnerStage, /COPY[^\n]*\/app\/\.mercato\/next/)
  assert.equal(runnerStage.match(/COPY[^\n]*--from=builder \/app\/\.mercato \.\/\.mercato/g)?.length, 1)
  assert.match(runnerStage, /COPY --chown=omuser:omuser --from=builder \/app\/\.mercato \.\/\.mercato/)
})

test('runner stage owns the runtime write targets without recursion', () => {
  assert.ok(runnerStage.indexOf('adduser -D -u 1001 omuser') < runnerStage.indexOf('COPY --chown=omuser:omuser'))
  assert.match(runnerStage, /mkdir -p \/app\/storage \/app\/node_modules\/\.cache/)
  assert.match(runnerStage, /chown omuser:omuser \/app \/app\/storage \/app\/node_modules\/\.cache/)
})
