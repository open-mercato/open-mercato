/**
 * Per-agent presentation icon invariants. Keeps the three sources of the icon
 * vocabulary in sync without importing the client-only `agentChips.tsx` (which
 * pulls in React + lucide): the canonical name list, the seeded default map, and
 * the client `AGENT_ICON` component map (asserted against source text).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { AGENT_ICON_NAMES, DEFAULT_AGENT_ICONS, isAgentIconName } from '../data/agentIcons'

const MODULE_ROOT = path.resolve(__dirname, '..')

describe('agent presentation icons', () => {
  it('exposes a non-empty, unique icon vocabulary', () => {
    expect(AGENT_ICON_NAMES.length).toBeGreaterThan(0)
    expect(new Set(AGENT_ICON_NAMES).size).toBe(AGENT_ICON_NAMES.length)
  })

  it('isAgentIconName accepts known names and rejects everything else', () => {
    for (const name of AGENT_ICON_NAMES) expect(isAgentIconName(name)).toBe(true)
    expect(isAgentIconName('not-an-icon')).toBe(false)
    expect(isAgentIconName(null)).toBe(false)
    expect(isAgentIconName(undefined)).toBe(false)
    expect(isAgentIconName(42)).toBe(false)
  })

  it('every seeded default icon is a member of the vocabulary', () => {
    for (const [agentId, icon] of Object.entries(DEFAULT_AGENT_ICONS)) {
      expect(isAgentIconName(icon)).toBe(true)
      expect(agentId).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('client AGENT_ICON map has a component entry for every vocabulary name', () => {
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'components', 'agentChips.tsx'), 'utf8')
    const mapBody = source.slice(source.indexOf('AGENT_ICON:'))
    for (const name of AGENT_ICON_NAMES) {
      // Keys are bare identifiers (`bot:`) or quoted kebab-case (`'heart-pulse':`).
      const key = /[a-z]+-[a-z]/.test(name) ? `'${name}':` : `${name}:`
      expect(mapBody.includes(key)).toBe(true)
    }
  })
})
