# Start the hybrid dev stack: infra containers up, then `yarn dev` in the
# foreground (app + MCP server). Ctrl+C stops the host processes; the
# containers keep running (stop them with stop.ps1).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
& node starters/lib/start.mjs @args
exit $LASTEXITCODE
