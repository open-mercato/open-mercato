import { resolveRelevantAgenticFiles } from '../agentic-init'

describe('resolveRelevantAgenticFiles', () => {
  it('returns only codex files for codex setup', () => {
    expect(resolveRelevantAgenticFiles('codex')).toEqual([
      '.codex/mcp.json.example',
    ])
  })

  it('returns only cursor files for cursor setup', () => {
    expect(resolveRelevantAgenticFiles('cursor')).toEqual([
      '.cursor/hooks.json',
    ])
  })

  it('returns combined files for multiple selected tools', () => {
    expect(resolveRelevantAgenticFiles('claude-code,cursor')).toEqual([
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json.example',
      '.cursor/hooks.json',
    ])
  })

  it('falls back to the full known file list when no tool is provided', () => {
    expect(resolveRelevantAgenticFiles()).toEqual([
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json.example',
      '.codex/mcp.json.example',
      '.cursor/hooks.json',
    ])
  })
})
