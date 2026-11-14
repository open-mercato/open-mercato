import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { test } from 'node:test'

const runNode = promisify(execFile)
const requireDocs = createRequire(new URL('../../apps/docs/package.json', import.meta.url))
const mermaidEntry = requireDocs.resolve('mermaid')

test('Mermaid bounds equal-axis XY charts while preserving ordinary diagram parsing', async () => {
  const source = `
    import assert from 'node:assert/strict'
    import { pathToFileURL } from 'node:url'
    const { default: mermaid } = await import(pathToFileURL(process.argv[1]))
    mermaid.initialize({ startOnLoad: false })
    const diagrams = [
      ['flowchart LR\\nA-->B', 'flowchart-v2'],
      ['sequenceDiagram\\nAlice->>Bob: Hello', 'sequence'],
      ['xychart\\nx-axis 1 --> 3\\nline [1,2,3]', 'xychart'],
      ['radar-beta\\naxis a,b\\ncurve c {1,1}\\nticks 5', 'radar'],
      ['xychart\\nx-axis 1 --> 1\\nline [1,2]', 'xychart'],
    ]
    for (const [diagramSource, expectedType] of diagrams) {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(diagramSource)
      assert.equal(diagram.type, expectedType)
    }
    console.log('bounded diagram parsing passed')
  `
  const { stdout } = await runNode(process.execPath, [
    '--max-old-space-size=128', '--input-type=module', '-e', source, mermaidEntry,
  ], { timeout: 15_000, maxBuffer: 64 * 1024 })
  assert.match(stdout, /bounded diagram parsing passed/)
})
