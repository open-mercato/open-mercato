import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function readSource(relativeUrl: string): string {
  return fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')
}

test('standalone and monorepo bootstraps explicitly wire the app DI registrar', () => {
  const sources = [
    readSource('../../template/src/bootstrap.ts'),
    readSource('../../../../apps/mercato/src/bootstrap.ts'),
  ]

  for (const source of sources) {
    assert.match(source, /import \{ register as registerAppDi \} from '@\/di'/)
    assert.match(source, /appDiRegistrar: registerAppDi/)
  }
})
