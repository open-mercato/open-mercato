import fs from 'node:fs'
import path from 'node:path'
import { findBoundaryViolations } from './support/importBoundary'

const blocksRoot = path.resolve(__dirname, '..')
const uiSrcRoot = path.resolve(blocksRoot, '..')
const fakeFile = path.join(blocksRoot, 'timeline', 'Timeline.tsx')

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('blocks import boundary', () => {
  it('flags domain packages', () => {
    const source = "import { x } from '@open-mercato/core/modules/customers/lib/x'\nimport { y } from '@open-mercato/search/lib/y'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(2)
  })

  it('flags data clients and mutation guards by package path and relative path', () => {
    const source = [
      "import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'",
      "import { fetchCrudList } from '../../backend/utils/crud'",
      "import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'",
      "import { useQuery } from '@tanstack/react-query'",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(4)
  })

  it('flags dynamic imports, requires and direct fetch calls', () => {
    const source = [
      "const mod = await import('@open-mercato/core/modules/sales/x')",
      "const other = require('@tanstack/react-query')",
      "await fetch('/api/x')",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(3)
  })

  it('allows primitives, shared helpers, zod and react', () => {
    const source = [
      "import * as React from 'react'",
      "import { z } from 'zod'",
      "import { Button } from '@open-mercato/ui/primitives/button'",
      "import { useT } from '@open-mercato/shared/lib/i18n/context'",
      "import { ActivityFeed } from '../../primitives/activity-feed'",
      "const prefetchLabel = 'prefetch(data)'",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([])
  })

  it('flags type-only imports from domain packages', () => {
    const source = "import type { X } from '@open-mercato/core/modules/customers/data/entities'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(1)
  })

  it('flags re-exports from forbidden packages', () => {
    const source = [
      "export * from '@tanstack/react-query'",
      "export { apiCall } from '@open-mercato/ui/backend/utils/apiCall'",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(2)
  })

  it('flags bare side-effect imports', () => {
    const source = "import '@open-mercato/core/x'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(1)
  })

  it('flags forbidden modules imported with a file extension', () => {
    const source = "import { apiCall } from '@open-mercato/ui/backend/utils/apiCall.ts'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(1)
  })

  it('flags multi-line named imports', () => {
    const source = "import {\n  apiCall,\n  apiCallOrThrow,\n} from '@open-mercato/ui/backend/utils/apiCall'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(1)
  })

  it('does not flag member or identifier-suffixed fetch lookalikes', () => {
    const source = ['client.fetch(url)', 'prefetch(url)', 'refetch()'].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([])
  })

  it('flags newly denylisted ui modules', () => {
    const source = [
      "import { a } from '@open-mercato/ui/backend/utils/customFieldDefs'",
      "import { b } from '@open-mercato/ui/backend/utils/customFieldFilters'",
      "import { c } from '../../backend/utils/customFieldRelationDisplay'",
      "import { d } from '@open-mercato/ui/backend/utils/useCurrentUserId'",
      "import { e } from '@open-mercato/ui/backend/utils/nav'",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(5)
  })

  it('flags fetchWithTimeout from shared but allows readJsonSafe', () => {
    const forbidden = "import { x } from '@open-mercato/shared/lib/http/fetchWithTimeout'"
    expect(findBoundaryViolations(forbidden, fakeFile, uiSrcRoot)).toEqual([
      'data or guard import: @open-mercato/shared/lib/http/fetchWithTimeout',
    ])
    const allowed = "import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'"
    expect(findBoundaryViolations(allowed, fakeFile, uiSrcRoot)).toEqual([])
  })

  it('flags forbidden bindings from any module, including aliases and type modifiers', () => {
    const source = [
      "import { useQuery as useData } from './wrapper'",
      "import { type Foo, apiCall } from '../local/helpers'",
      "import {\n  fetchWithTimeout,\n  other,\n} from '../local/http'",
    ].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([
      'forbidden binding: useQuery from ./wrapper',
      'forbidden binding: apiCall from ../local/helpers',
      'forbidden binding: fetchWithTimeout from ../local/http',
    ])
  })

  it('flags every listed forbidden binding and re-exports', () => {
    const names = [
      'apiCall',
      'apiCallOrThrow',
      'readApiResultOrThrow',
      'useGuardedMutation',
      'fetchWithTimeout',
      'fetchCrudList',
      'useQuery',
      'useQueries',
      'useMutation',
      'useQueryClient',
      'useInfiniteQuery',
    ]
    const source = `export { ${names.join(', ')} } from './wrapper'`
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toHaveLength(names.length)
  })

  it('does not flag similar binding names or one violation twice for a forbidden module', () => {
    const source = "import { apiCallLabel, useQueryParams, queryClient } from './helpers'"
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([])
    const doubled = "import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'"
    expect(findBoundaryViolations(doubled, fakeFile, uiSrcRoot)).toHaveLength(1)
  })

  it('flags window, globalThis and self fetch calls', () => {
    const source = ['window.fetch(url)', 'globalThis.fetch (url)', 'self.fetch(url)'].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([
      'direct fetch call',
      'direct fetch call',
      'direct fetch call',
    ])
  })

  it('does not flag other member fetch calls next to global ones', () => {
    const source = ['client.fetch(url)', 'myWindow.fetch(url)', 'window.prefetch(url)', 'this.refetch()'].join('\n')
    expect(findBoundaryViolations(source, fakeFile, uiSrcRoot)).toEqual([])
  })

  it('finds no violations in the real blocks tree', () => {
    const violations = listSourceFiles(blocksRoot).flatMap((file) =>
      findBoundaryViolations(fs.readFileSync(file, 'utf8'), file, uiSrcRoot).map(
        (violation) => `${path.relative(blocksRoot, file)}: ${violation}`,
      ),
    )
    expect(violations).toEqual([])
  })
})
