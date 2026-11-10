import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const materializerPath = path.resolve(
  'packages/documents/dist/modules/documents/lib/collabMaterializer.js',
)

test('the built Documents materializer lazy-loads real Happy DOM and closes every window', () => {
  const probe = String.raw`
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'

    const requireFromProbe = createRequire(import.meta.url)
    const happyDomEntry = requireFromProbe.resolve('happy-dom')
    delete requireFromProbe.cache[happyDomEntry]

    const materializer = await import(${JSON.stringify(pathToFileURL(materializerPath).href)})
    assert.equal(requireFromProbe.cache[happyDomEntry], undefined, 'module import must not eagerly load Happy DOM')

    const first = materializer.materializeDocumentHtml('<p><strong>Lazy</strong> runtime</p>')
    assert.ok(first)
    assert.match(first.html, /<strong>Lazy<\/strong> runtime/)
    assert.equal(first.text, 'Lazy runtime')
    assert.ok(requireFromProbe.cache[happyDomEntry], 'first conversion must load the real Happy DOM module')

    const happyDom = requireFromProbe('happy-dom')
    const probeWindow = new happyDom.Window()
    const lifecyclePrototype = Object.getPrototypeOf(probeWindow.happyDOM)
    probeWindow.happyDOM.close()
    const originalAbort = lifecyclePrototype.abort
    const originalClose = lifecyclePrototype.close
    let abortCount = 0
    let closeCount = 0
    lifecyclePrototype.abort = function (...args) {
      abortCount += 1
      return originalAbort.apply(this, args)
    }
    lifecyclePrototype.close = function (...args) {
      closeCount += 1
      return originalClose.apply(this, args)
    }

    try {
      const second = materializer.materializeDocumentHtml('<p>Cleanup runtime</p>')
      assert.ok(second)
      assert.equal(second.text, 'Cleanup runtime')
      assert.equal(abortCount, 2, 'HTML parsing and serialization must each abort their Happy DOM window')
      assert.equal(closeCount, 2, 'HTML parsing and serialization must each close their Happy DOM window')
    } finally {
      lifecyclePrototype.abort = originalAbort
      lifecyclePrototype.close = originalClose
    }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  })

  assert.equal(
    result.status,
    0,
    `compiled Documents materializer probe must complete without leaked Happy DOM resources\n${result.stdout}\n${result.stderr}`,
  )
})
