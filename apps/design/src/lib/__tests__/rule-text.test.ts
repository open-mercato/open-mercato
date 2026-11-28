import { splitRuleText } from '../rule-text'

const codeOf = (text: string) => splitRuleText(text).filter((part) => part.kind === 'code').map((part) => part.value)

describe('splitRuleText', () => {
  it('marks utility classes, custom properties and arbitrary values as code', () => {
    expect(codeOf('The scale derives from the --radius base token (10px): sm 6px.')).toEqual(['--radius'])
    expect(codeOf('Cards and panels use rounded-lg; controls use rounded-md.')).toEqual(['rounded-lg', 'rounded-md'])
    expect(codeOf('No arbitrary values (rounded-[24px]) — pick from the scale.')).toEqual(['rounded-[24px]'])
  })

  it('marks component names, props and prop assignments as code', () => {
    expect(codeOf('rounded-full is reserved for Badge, Tag, SegmentedControl, Avatar and status dots.')).toEqual(['rounded-full', 'SegmentedControl'])
    expect(codeOf('Return a promise from onAction so the bar shows the pending state')).toEqual(['onAction'])
    expect(codeOf('Use position="inline" inside dialogs')).toEqual(['position="inline"'])
    expect(codeOf('use entityHeaderTabIds(idBase, activeTabKey) to set ids')).toEqual(['entityHeaderTabIds(idBase, activeTabKey)'])
  })

  it('leaves ordinary hyphenated words alone', () => {
    expect(codeOf('No full-pill radii on filter chips or sign-in pages, one-click away.')).toEqual([])
  })

  it('keeps the original text when joined back', () => {
    const text = 'Pass totalCount and onSelectAllMatching when the list has more records (rounded-md).'
    expect(splitRuleText(text).map((part) => part.value).join('')).toBe(text)
  })
})
