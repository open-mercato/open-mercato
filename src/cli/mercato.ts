#!/usr/bin/env tsx
import { run as runMercato } from '@mercato-cli/mercato'

runMercato(process.argv)
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error('💥 CLI crashed:', e)
    process.exit(1)
  })
