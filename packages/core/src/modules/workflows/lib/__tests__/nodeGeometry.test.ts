/**
 * Node geometry has ONE source of truth.
 *
 * The card that renders a node and the dagre layout that reserves space for it
 * used to keep private copies of the same numbers, synchronised only by a
 * comment. Drift between them is invisible until ranks overlap, so this guard
 * fails the moment a consumer re-declares its own width/height literal instead
 * of importing `lib/node-geometry`.
 */
import fs from 'fs'
import path from 'path'
import {
  NODE_DESCRIPTION_HEIGHT,
  NODE_HEIGHT,
  NODE_MAX_WIDTH,
  NODE_MIN_WIDTH,
} from '../node-geometry'

const moduleRoot = path.join(__dirname, '..', '..')

const CONSUMERS = [
  path.join(moduleRoot, 'components', 'WorkflowNodeCard.tsx'),
  path.join(moduleRoot, 'lib', 'graph-utils.ts'),
  path.join(moduleRoot, 'lib', 'node-placement.ts'),
]

const LOCAL_DECLARATION = /^\s*(?:export\s+)?const\s+\w*NODE_\w*(?:WIDTH|HEIGHT)\w*\s*=\s*\d+/gm

describe('node geometry single source of truth', () => {
  it('exposes sane bounds', () => {
    expect(NODE_MIN_WIDTH).toBeLessThan(NODE_MAX_WIDTH)
    expect(NODE_HEIGHT).toBeGreaterThan(0)
    expect(NODE_DESCRIPTION_HEIGHT).toBeGreaterThan(0)
  })

  it.each(CONSUMERS)('does not re-declare a node dimension literal in %s', (file) => {
    const source = fs.readFileSync(file, 'utf8')
    const matches = source.match(LOCAL_DECLARATION) ?? []
    expect(matches).toEqual([])
  })

  it.each(CONSUMERS)('imports the shared geometry module in %s', (file) => {
    const source = fs.readFileSync(file, 'utf8')
    expect(source).toMatch(/from '(?:\.|\.\.)\/(?:lib\/)?node-geometry'/)
  })
})
