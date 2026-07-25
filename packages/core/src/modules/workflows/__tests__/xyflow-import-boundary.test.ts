/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the lazy @xyflow/react boundary (#3169).
 *
 * React Flow (~12 MB) must only enter the module graph through the lazy
 * `WorkflowGraphImpl` implementation (loaded via next/dynamic, ssr:false).
 * Adjacent workflow pages, dialogs, and graph-data utilities must therefore
 * import React Flow types with `import type` only, never pull runtime helpers
 * (addEdge / applyNodeChanges / applyEdgeChanges) into their chunks.
 */

const moduleRoot = join(__dirname, '..')

const read = (relativePath: string): string =>
  readFileSync(join(moduleRoot, relativePath), 'utf8')

// Extract whole import statements (this codebase omits semicolons, so anchor
// each statement to a line-leading `import` and stop at its `from '...'`).
const importStatements = (src: string): string[] =>
  src.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []

const xyflowValueImports = (src: string): string[] =>
  importStatements(src).filter(
    (statement) =>
      /from\s+['"]@xyflow\/react['"]/.test(statement) &&
      !/^import\s+type\b/.test(statement),
  )

// Files that only consume React Flow types or plain graph data — they must
// never import React Flow runtime values.
const typeOnlyConsumers = [
  'components/WorkflowGraph.tsx',
  'components/NodeEditDialog.tsx',
  'components/EdgeEditDialog.tsx',
  'components/NodeEditDialogCrudForm.tsx',
  'components/EdgeEditDialogCrudForm.tsx',
  'backend/instances/[id]/page.tsx',
  'backend/definitions/visual-editor/page.tsx',
  'lib/graph-utils.ts',
]

describe('@xyflow/react lazy boundary (#3169)', () => {
  test.each(typeOnlyConsumers)(
    '%s imports @xyflow/react with `import type` only',
    (relativePath) => {
      const valueImports = xyflowValueImports(read(relativePath))
      expect(valueImports).toEqual([])
    },
  )

  test('the visual editor page does not pull React Flow runtime reducers into its chunk', () => {
    const src = read('backend/definitions/visual-editor/page.tsx')
    const xyflowStatements = importStatements(src).filter((statement) =>
      /from\s+['"]@xyflow\/react['"]/.test(statement),
    )
    const runtimeHelper = /\b(addEdge|applyNodeChanges|applyEdgeChanges)\b/
    expect(xyflowStatements.some((statement) => runtimeHelper.test(statement))).toBe(false)
  })

  test('the lazy implementation remains the React Flow runtime boundary', () => {
    // Sanity: WorkflowGraphImpl is the one place that may import runtime values.
    const src = read('components/WorkflowGraphImpl.tsx')
    expect(xyflowValueImports(src).length).toBeGreaterThan(0)
  })
})
