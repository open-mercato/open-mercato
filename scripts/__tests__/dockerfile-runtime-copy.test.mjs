import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('production Dockerfile avoids duplicating the generated Next output layer', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')

  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato\/next \.\/apps\/mercato\/\.mercato\/next/,
  )
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato\/generated \.\/apps\/mercato\/\.mercato\/generated/,
  )
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato\/queue \.\/apps\/mercato\/\.mercato\/queue/,
  )
  assert.doesNotMatch(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato \.\/apps\/mercato\/\.mercato/,
  )
})
