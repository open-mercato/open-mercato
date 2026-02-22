import { describe, it, expect } from '@jest/globals'
import { parseCliArgs, buildUsage, validateRequiredArgs } from '../args.js'

describe('parseCliArgs', () => {
  it('should parse simple string arguments', () => {
    const result = parseCliArgs(['--name', 'John', '--age', '30'])
    expect(result.args.name).toBe('John')
    expect(result.args.age).toBe('30')
    expect(result.missing).toEqual([])
  })

  it('should parse boolean flags', () => {
    const result = parseCliArgs(['--verbose', '--force'], {
      boolean: ['verbose', 'force']
    })
    expect(result.args.verbose).toBe(true)
    expect(result.args.force).toBe(true)
  })

  it('should parse equals syntax', () => {
    const result = parseCliArgs(['--name=John', '--age=30'])
    expect(result.args.name).toBe('John')
    expect(result.args.age).toBe('30')
  })

  it('should handle missing required arguments', () => {
    const result = parseCliArgs(['--name', 'John'], {
      required: ['name', 'email']
    })
    expect(result.args.name).toBe('John')
    expect(result.missing).toContain('email')
  })

  it('should parse array arguments', () => {
    const result = parseCliArgs(['--tag', 'a', '--tag', 'b'], {
      array: ['tag']
    })
    expect(result.args.tag).toEqual(['a', 'b'])
  })

  it('should handle aliases', () => {
    const result = parseCliArgs(['-o', 'value'], {
      alias: { o: 'org' }
    })
    expect(result.args.org).toBe('value')
  })

  it('should collect positional arguments', () => {
    const result = parseCliArgs(['--flag', 'pos1', 'pos2'])
    expect(result.args.flag).toBe(true)
    expect(result.positional).toEqual(['pos1', 'pos2'])
  })

  it('should use default values', () => {
    const result = parseCliArgs([], {
      default: { name: 'default', count: 0 },
      string: ['name']
    })
    expect(result.args.name).toBe('default')
    expect(result.args.count).toBe(0)
  })

  it('should override defaults with provided values', () => {
    const result = parseCliArgs(['--name', 'override'], {
      default: { name: 'default' }
    })
    expect(result.args.name).toBe('override')
  })

  it('should handle combined short flags', () => {
    const result = parseCliArgs(['-abc'], {
      alias: { a: 'all', b: 'brief', c: 'color' },
      boolean: ['all', 'brief', 'color']
    })
    expect(result.args.all).toBe(true)
    expect(result.args.brief).toBe(true)
    expect(result.args.color).toBe(true)
  })
})

describe('buildUsage', () => {
  it('should build basic usage string', () => {
    const usage = buildUsage('command', {
      required: ['org', 'tenant'],
      string: ['name'],
      boolean: ['verbose']
    })
    expect(usage).toContain('command')
    expect(usage).toContain('--org')
    expect(usage).toContain('--tenant')
  })

  it('should include aliases in usage', () => {
    const usage = buildUsage('cmd', {
      required: ['org'],
      alias: { o: 'org' }
    })
    expect(usage).toContain('-o')
  })
})

describe('validateRequiredArgs', () => {
  it('should return null for valid args', () => {
    const result = validateRequiredArgs({ name: 'test', age: '30' }, ['name', 'age'])
    expect(result).toBeNull()
  })

  it('should return error message for missing args', () => {
    const result = validateRequiredArgs({ name: 'test' }, ['name', 'email'])
    expect(result).toContain('Missing required arguments')
    expect(result).toContain('--email')
  })

  it('should handle multiple missing args', () => {
    const result = validateRequiredArgs({}, ['org', 'tenant'])
    expect(result).toContain('--org')
    expect(result).toContain('--tenant')
  })
})
