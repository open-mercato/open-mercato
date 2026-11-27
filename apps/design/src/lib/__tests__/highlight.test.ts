import { tokenizeCode } from '../highlight'

const kinds = (code: string) => tokenizeCode(code).filter((token) => token.value.trim()).map((token) => `${token.kind}:${token.value.trim()}`)

describe('tokenizeCode', () => {
  it('keeps the source text intact', () => {
    const code = "import { StatStrip } from '@open-mercato/ui/blocks/stat-strip'\n\n<StatStrip\n  ariaLabel=\"Sales summary\"\n  items={[{ id: 'a', value: 12 }]}\n/>"
    expect(tokenizeCode(code).map((token) => token.value).join('')).toBe(code)
  })

  it('marks keywords, strings, tags and attributes', () => {
    expect(kinds("import { Button } from 'x'")).toEqual(['keyword:import', 'punctuation:{', 'plain:Button', 'punctuation:}', 'keyword:from', "string:'x'"])
    expect(kinds('<Button size="sm" onClick={save}>Save</Button>')).toEqual([
      'punctuation:<', 'tag:Button', 'attribute:size', 'punctuation:=', 'string:"sm"', 'attribute:onClick', 'punctuation:={', 'plain:save', 'punctuation:}>',
      'plain:Save', 'punctuation:</', 'tag:Button', 'punctuation:>',
    ])
  })

  it('marks comments, numbers and dotted tags', () => {
    expect(kinds('// note\nconst count = 42')).toEqual(['comment:// note', 'keyword:const', 'plain:count', 'punctuation:=', 'number:42'])
    expect(kinds('<Tabs.List />')).toEqual(['punctuation:<', 'tag:Tabs.List', 'punctuation:/>'])
  })

  it('does not treat a comparison as a tag', () => {
    expect(kinds('a < b')).toEqual(['plain:a', 'punctuation:<', 'plain:b'])
  })
})
