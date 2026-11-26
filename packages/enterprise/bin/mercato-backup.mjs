#!/usr/bin/env node
// This dedicated process owns stdout; configure diagnostics before logger modules initialize.
process.env.OM_LOG_DESTINATION = 'stderr'
const { runBackupCli } = await import('../dist/modules/backups/lib/engine/cli/main.js')
process.exitCode = await runBackupCli(process.argv.slice(2))
