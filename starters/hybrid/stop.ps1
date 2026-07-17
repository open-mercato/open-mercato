# Stop the hybrid infra containers (data preserved). Pass `--volumes --yes`
# for a full destructive reset. Stop `yarn dev` itself with Ctrl+C.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
& node starters/lib/stop.mjs @args
exit $LASTEXITCODE
