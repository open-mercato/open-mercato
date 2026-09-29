import { resolveCliBootstrapMode } from '../cli-bootstrap-mode'

describe('resolveCliBootstrapMode', () => {
  it('uses the lightweight manifest only for the exact server dev command', () => {
    expect(resolveCliBootstrapMode(['node', 'mercato', 'server', 'dev'])).toBe('dev-supervisor')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'server', 'dev', '--port', '4000'])).toBe('dev-supervisor')
  })

  it('keeps production, workers, scheduler, and module commands on the full bootstrap', () => {
    expect(resolveCliBootstrapMode(['node', 'mercato', 'server', 'start'])).toBe('full')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'queue', 'worker', '--all'])).toBe('full')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'scheduler', 'start'])).toBe('full')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'customers', 'seed'])).toBe('full')
  })

  it('preserves existing bootstrap-free commands', () => {
    expect(resolveCliBootstrapMode(['node', 'mercato', 'generate'])).toBe('none')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'db', 'generate'])).toBe('none')
    expect(resolveCliBootstrapMode(['node', 'mercato', 'help'])).toBe('none')
    expect(resolveCliBootstrapMode(['node', 'mercato'])).toBe('none')
  })
})
