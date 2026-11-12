#!/usr/bin/env node
import { runBackupCli } from '../dist/modules/backups/lib/engine/cli/main.js'
process.exitCode = await runBackupCli(process.argv.slice(2))
