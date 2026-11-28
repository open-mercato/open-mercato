import { parseModuleCliOptions } from '../parseModuleCliOptions'

describe('parseModuleCliOptions', () => {
  it.each([
    [['--key=a=b'], { key: 'a=b' }],
    [['--key='], { key: '' }],
    [['--key==a=='], { key: '=a==' }],
    [['--key', 'a=b'], { key: 'a=b' }],
    [['--key', 'value'], { key: 'value' }],
    [['--flag', '--other=true'], { flag: true, other: 'true' }],
    [['positional', '-short', '', '--key=value', 'ignored'], { key: 'value' }],
    [['--key=first', '--key', 'second'], { key: 'second' }],
    [['--key', '', '--next'], { key: true, next: true }],
    [['--=value', '--', '-- spaced =value'], { '': true, ' spaced ': 'value' }],
  ])('parses %j', (tokens, expected) => {
    expect(parseModuleCliOptions(tokens)).toEqual(expected)
  })

  it('ignores bare flags for string-only catalog, sales, planner, resources and staff CLIs', () => {
    const options: Record<string, string> = parseModuleCliOptions(
      ['--bare', '--enabled=true', '--empty=', '--name', 'value'],
      { flagValue: undefined },
    )
    expect(options).toEqual({ enabled: 'true', empty: '', name: 'value' })
  })

  it('preserves string flags and non-advancing values for customers and seeds', () => {
    const options: Record<string, string> = parseModuleCliOptions(
      ['--bare', '--name', '', '--=ignored', '--key=a=b'],
      { flagValue: 'true', skipEmptyKeys: true, consumeEmptyValues: true, advancePastValue: false },
    )
    expect(options).toEqual({ bare: 'true', name: '', key: 'a=b' })
  })

  it('accepts empty space-separated values for configs, search and query_index', () => {
    expect(parseModuleCliOptions(['--key', '', '--next', '--=ignored'], {
      consumeEmptyValues: true,
      skipEmptyKeys: true,
    })).toEqual({ key: '', next: true })
  })

  it('trims keys and ignores empty keys for attachments and customer_groups', () => {
    expect(parseModuleCliOptions(['-- name = a=b ', '-- =ignored', '--', '--empty', ''], {
      trimKeys: true,
      skipEmptyKeys: true,
    })).toEqual({ name: ' a=b ', empty: true })
  })

  it('skips empty keys without trimming whitespace for feature_toggles', () => {
    expect(parseModuleCliOptions(['--=ignored', '-- name =value', '--empty', ''], {
      skipEmptyKeys: true,
    })).toEqual({ ' name ': 'value', empty: true })
  })

  it('does not mutate the input tokens', () => {
    const tokens = Object.freeze(['--key', 'value', '--flag'])
    expect(parseModuleCliOptions(tokens)).toEqual({ key: 'value', flag: true })
    expect(tokens).toEqual(['--key', 'value', '--flag'])
  })
})
