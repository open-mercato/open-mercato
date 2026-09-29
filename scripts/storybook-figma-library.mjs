import fs from 'node:fs'
import path from 'node:path'

// Figma evidence is kept separately from implementation links. A related
// story must never be promoted automatically to a visual parity claim.
export function buildFigmaLibrary(root, catalogue) {
  const directory = path.join(root, 'docs/design-system/figma-audit')
  const read = (name, fallback = {}) => {
    const file = path.join(directory, `${name}.json`)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
  }
  const manifest = read('pages', [])
  const links = read('story-links')
  const scope = read('catalogue-scope')
  const excludedGroups = new Set(scope.excludedGroups ?? [])
  const excludedPageIds = new Set(scope.excludedPageIds ?? [])
  const baselineGaps = new Map()
  for (const file of ['base-components.md', 'product-landing.md']) {
    const baselineFile = path.join(directory, file)
    if (!fs.existsSync(baselineFile)) continue
    for (const row of fs.readFileSync(baselineFile, 'utf8').split('\n')) {
      const cells = row.split('|').slice(1, -1).map(cell => cell.trim())
      const node = cells[0]?.match(/node-id=(\d+)-(\d+)/)
      if (node && cells.length === 5) baselineGaps.set(`${node[1]}:${node[2]}`, cells[4])
      if (node && cells.length === 3) baselineGaps.set(`${node[1]}:${node[2]}`, cells[2])
    }
  }
  const inventories = ['foundations-assets', 'base-components', 'avatar', 'product-landing'].map(name => read(name))
  const records = inventories.flatMap(inventory => inventory.pages ?? [])
  const contexts = ['foundations-assets-context', 'base-components-context', 'product-landing-context', 'avatar'].map(name => read(name))
  const contextPages = new Set(contexts.flatMap(context => {
    const items = context.references ?? context.contexts ?? context.designContexts ?? []
    return Array.isArray(items) ? items : Object.values(items)
  }).filter(item => item.status !== 'error' && !item.isError).map(item => item.pageId ?? item.id))
  if (read('avatar').contextNodeIds?.length) contextPages.add('210:4129')
  const foundationContexts = Object.values(read('foundations-assets-context').contexts ?? {})
  for (const record of read('foundations-assets').pages ?? []) {
    if (foundationContexts.some(context => context.nodeId === record.representativeContextNodeId && !context.isError)) contextPages.add(record.id)
  }
  const cleanName = name => name.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  let group = 'Getting started'
  let sectionPageCount = 0
  let excludedPageCount = 0
  const pages = []
  for (const page of manifest) {
    if (page.name.startsWith('✲')) {
      group = cleanName(page.name)
      sectionPageCount += 1
      continue
    }
    const pageGroup = page.id === '199833:76012' ? 'Sector Products' : group
    if (excludedGroups.has(pageGroup) || excludedPageIds.has(page.id)) {
      excludedPageCount += 1
      continue
    }
    const record = records.find(record => (record.id ?? record.pageId) === page.id)
    const stories = (links[page.id] ?? []).map(id => {
      const entry = catalogue.find(entry => entry.id === id)
      if (!entry) throw new Error(`Figma page ${page.id} links to missing gallery entry ${id}`)
      return { entryId: entry.id, family: entry.family, title: entry.title, storyId: entry.storyId, variantCount: entry.variantCount }
    })
    pages.push({
      id: page.id,
      name: cleanName(page.name),
      group: pageGroup,
      inspected: Boolean(record),
      contextRead: contextPages.has(page.id),
      baselineGap: baselineGaps.get(page.id) ?? null,
      sets: (record?.sets ?? []).map(set => ({ id: set.id, name: set.name, count: set.variantCount ?? set.count ?? 0, axes: set.axes ?? {} })),
      standalone: (record?.standalone ?? record?.standaloneComponents ?? []).map(node => {
        const item = Array.isArray(node) ? { id: node[0], name: node[1] } : { id: node.id, name: node.name }
        if (!item.id || !item.name) throw new Error(`Invalid standalone Figma asset on page ${page.id}`)
        return item
      }),
      standaloneCount: record?.standalone?.length ?? record?.standaloneCount ?? record?.standaloneComponentCount ?? 0,
      frameCount: (record?.top ?? record?.topLevel ?? []).filter(node => node.type === 'FRAME').length,
      stories,
    })
  }
  if (new Set(pages.map(page => page.id)).size !== pages.length) throw new Error('Duplicate Figma page IDs')
  return { manifestPageCount: manifest.length, sectionPageCount, excludedPageCount, pages }
}
