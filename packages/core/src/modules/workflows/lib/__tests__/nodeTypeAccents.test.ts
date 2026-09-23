/**
 * Canvas visual fidelity gap 3: node type is encoded on its own channel, and
 * that channel is made of DS tokens.
 *
 * Node type is CATEGORICAL, so it belongs to the `chart-*` palette; node status
 * is SEMANTIC, so it keeps `status-*`. Mixing them is what made the card border
 * carry two meanings at once. Raw Tailwind palette shades (`text-blue-500`)
 * are banned outright — they have no guaranteed dark-mode value.
 */
import {
  NODE_TYPE_ACCENTS,
  NODE_TYPE_COLORS,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type NodeType,
} from '../node-type-icons'

const RAW_TAILWIND_SHADE = /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

const NODE_TYPES = Object.keys(NODE_TYPE_ICONS) as NodeType[]

describe('node type accents are DS tokens', () => {
  it('covers every node type with an icon colour, an accent and a label', () => {
    for (const nodeType of NODE_TYPES) {
      expect(NODE_TYPE_COLORS[nodeType]).toBeTruthy()
      expect(NODE_TYPE_ACCENTS[nodeType]).toBeTruthy()
      expect(NODE_TYPE_LABELS[nodeType]).toBeTruthy()
    }
  })

  it('uses no raw Tailwind palette shade anywhere in either table', () => {
    for (const nodeType of NODE_TYPES) {
      expect(NODE_TYPE_COLORS[nodeType]).not.toMatch(RAW_TAILWIND_SHADE)
      expect(NODE_TYPE_ACCENTS[nodeType]).not.toMatch(RAW_TAILWIND_SHADE)
    }
  })

  it('encodes type from the categorical palette, never from a status token', () => {
    const categoricalTypes: NodeType[] = ['userTask', 'automated', 'subWorkflow', 'waitForSignal', 'waitForTimer']
    for (const nodeType of categoricalTypes) {
      expect(NODE_TYPE_COLORS[nodeType]).toMatch(/^text-chart-/)
      expect(NODE_TYPE_ACCENTS[nodeType]).toMatch(/^border-t-chart-/)
      expect(NODE_TYPE_COLORS[nodeType]).not.toMatch(/status-/)
    }
  })

  it('keeps the agent node on brand-violet, which the DS reserves for AI', () => {
    expect(NODE_TYPE_COLORS.invokeAgent).toBe('text-brand-violet')
    expect(NODE_TYPE_ACCENTS.invokeAgent).toBe('border-t-brand-violet')
  })

  it('leaves terminals uncapped — they are pills, not capped step cards', () => {
    expect(NODE_TYPE_ACCENTS.start).toBe('border-t-border')
    expect(NODE_TYPE_ACCENTS.end).toBe('border-t-border')
  })

  it('never reaches for an arbitrary value', () => {
    for (const nodeType of NODE_TYPES) {
      expect(NODE_TYPE_COLORS[nodeType]).not.toContain('[')
      expect(NODE_TYPE_ACCENTS[nodeType]).not.toContain('[')
    }
  })
})
