/**
 * Handle geometry comes from ONE constant.
 *
 * Every node component used to spell its own `!w-3 !h-3 !border-2
 * !border-background`, and the outcome-row footer spelled a smaller one — so a
 * footer dot and the generic source handle floating beside it rendered at
 * different diameters on the same card, which is what the maintainer reported
 * as "different sizes". A previous fix already found three private copies of
 * node geometry drifting apart; this pins the handle half of it so a fourth
 * cannot appear.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  NODE_HANDLE_BORDER_CLASS,
  NODE_HANDLE_CLASS,
  NODE_HANDLE_EDGE_OFFSET,
  NODE_HANDLE_SIZE,
  NODE_HANDLE_SIZE_CLASS,
  NODE_PORT_HANDLE_CLASS,
} from '../../lib/node-geometry'

const NODES_DIR = path.join(__dirname, '..', 'nodes')

function readNodeSources(): Array<{ file: string; source: string }> {
  return fs
    .readdirSync(NODES_DIR)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: fs.readFileSync(path.join(NODES_DIR, file), 'utf8') }))
}

describe('node connection handles share one geometry constant', () => {
  it('derives the Tailwind size from the pixel size', () => {
    expect(NODE_HANDLE_SIZE).toBe(12)
    expect(NODE_HANDLE_SIZE_CLASS).toBe('!h-3 !w-3')
    expect(NODE_HANDLE_CLASS).toBe(`${NODE_HANDLE_SIZE_CLASS} ${NODE_HANDLE_BORDER_CLASS}`)
  })

  it('overhangs an edge by exactly half a handle, so it straddles rather than floats', () => {
    expect(NODE_HANDLE_EDGE_OFFSET).toBe(-NODE_HANDLE_SIZE / 2)
  })

  it('keeps the smaller sub-workflow port size a deliberate decision in the same file', () => {
    expect(NODE_PORT_HANDLE_CLASS).not.toContain(NODE_HANDLE_SIZE_CLASS)
    expect(NODE_PORT_HANDLE_CLASS).toContain('!h-2.5 !w-2.5')
  })

  it('leaves no node component spelling a handle size of its own', () => {
    const offenders = readNodeSources()
      .filter(({ source }) => /!(?:w|h)-(?:3|2\.5)\b/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('renders every handle through the shared class', () => {
    const offenders = readNodeSources()
      .filter(({ source }) => source.includes('<Handle'))
      .filter(({ source }) => !/NODE_(?:PORT_)?HANDLE_CLASS/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('names the default source handle from the frozen constant, never a literal', () => {
    const offenders = readNodeSources()
      .filter(({ source }) => source.includes('id="source"'))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
