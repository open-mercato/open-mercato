import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/en.json'), 'utf8')) as Record<string, string>
const sources = ['src/components/IntroContent.tsx', 'src/components/home/LivePanel.tsx', 'src/components/home/WhatsNew.tsx'].map((file) =>
  fs.readFileSync(path.join(root, file), 'utf8'),
)

describe('home page copy', () => {
  it('has a dictionary entry for every literal design.home and design.intro key', () => {
    const keys = new Set<string>()
    for (const source of sources) {
      for (const match of source.matchAll(/t\('((?:design\.home|design\.intro)\.[A-Za-z0-9.-]+)'\)/g)) keys.add(match[1])
    }
    expect(keys.size).toBeGreaterThan(40)
    for (const key of keys) expect(dictionary[key]).toBeTruthy()
  })

  it('has titles for every highlighted entry and news item', () => {
    for (const id of ['timeline', 'spacing', 'border-beam', 'splitter', 'anchor', 'key-value']) {
      expect(dictionary[`design.home.whatsNew.items.${id}`]).toBeTruthy()
    }
    for (const id of ['timeline', 'spacing', 'primitives']) {
      expect(dictionary[`design.home.news.${id}.title`]).toBeTruthy()
      expect(dictionary[`design.home.news.${id}.body`]).toBeTruthy()
    }
  })
})
