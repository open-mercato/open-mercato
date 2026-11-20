import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const migrationsDir = path.resolve(__dirname, '../migrations')
const scriptPath = path.join(migrationsDir, 'adopt-squash.mjs')

describe('migrations/adopt-squash.mjs', () => {
  it('refuses to run against a squash it was not written for, before touching a database', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'postgres://invalid.invalid:1/never' },
      timeout: 20_000,
    })
    const currentSquashes = fs
      .readdirSync(migrationsDir)
      .filter((name) => /^Migration\d+_agent_orchestrator\.ts$/.test(name))
      .map((name) => name.slice(0, -'.ts'.length))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('targets Migration20260811150000_agent_orchestrator')
    for (const squash of currentSquashes) expect(result.stderr).toContain(squash)
    expect(result.stdout).not.toContain('Adopting the squash')
  })
})
