# Open Mercato — hybrid dev environment installer for Windows.
#
# Hybrid = the app and the MCP server run natively on this machine (yarn dev),
# while OpenCode + postgres/redis/meilisearch run in containers.
#
# Standalone (no clone yet):
#   irm https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/hybrid/install.ps1 | iex
# Inside a clone (or double-click install.bat):
#   .\starters\hybrid\install.ps1 [-Branch <name>] [-CloneRoot <path>] [-SkipDb]
#       [-SkipLlmPrompt] [-NonInteractive] [-NoStart] [-Runtime auto|docker|rancher]
#
# This bootstrap ensures git, native Node 24 + corepack yarn (via
# windows-toolchain.ps1), and a container runtime, then hands off to
# `node starters/lib/install.mjs` (the shared cross-platform pipeline).
#
# Locked-down corporate machine (proxy/TLS interception, no admin, WSL2
# blocked)? Use the fully containerized enterprise launcher instead:
#   starters\docker\windows\start-windows.bat
[CmdletBinding()]
param(
    [string]$Branch = "main",
    [string]$CloneRoot = "",
    [switch]$SkipDb,
    [switch]$SkipLlmPrompt,
    [switch]$NonInteractive,
    [switch]$NoStart,
    [ValidateSet("auto", "docker", "rancher")][string]$Runtime = "auto"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoUrl = "https://github.com/open-mercato/open-mercato.git"

function Write-Info { param([string]$Message) Write-Host "[install] $Message" -ForegroundColor Cyan }
function Write-WarnMsg { param([string]$Message) Write-Host "[install] $Message" -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host "[install] $Message" -ForegroundColor Red; exit 1 }

function Test-Command { param([string]$Name) [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# --- git ---------------------------------------------------------------------
if (-not (Test-Command "git")) {
    if (Test-Command "winget") {
        Write-Info "Installing Git via winget ..."
        winget install --id Git.Git --accept-source-agreements --accept-package-agreements --silent
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    }
    if (-not (Test-Command "git")) {
        Write-Fail "git is missing and winget could not install it. Install Git for Windows, then re-run."
    }
}

# --- locate or clone the repo ------------------------------------------------
function Find-RepoRoot {
    $dir = (Get-Location).Path
    while ($dir) {
        $pkg = Join-Path $dir "package.json"
        if ((Test-Path $pkg) -and ((Get-Content $pkg -Raw) -match '"name": "open-mercato"')) { return $dir }
        $parent = Split-Path -Parent $dir
        if ($parent -eq $dir) { break }
        $dir = $parent
    }
    return $null
}

$repoRoot = Find-RepoRoot
if ($repoRoot) {
    Write-Info "Using existing clone: $repoRoot"
} else {
    $base = if ($CloneRoot) { $CloneRoot } else { (Get-Location).Path }
    $repoRoot = Join-Path $base "open-mercato"
    if (Test-Path (Join-Path $repoRoot ".git")) {
        Write-Info "Using existing clone: $repoRoot"
    } else {
        Write-Info "Cloning open-mercato ($Branch) into $repoRoot ..."
        git clone --branch $Branch $RepoUrl $repoRoot
        if ($LASTEXITCODE -ne 0) { Write-Fail "git clone failed." }
    }
}
Set-Location $repoRoot

# --- native toolchain: Node 24 + corepack yarn -------------------------------
$needsNode = $true
if (Test-Command "node") {
    $major = (& node -p "process.versions.node.split('.')[0]") 2>$null
    if ($major -eq "24") { $needsNode = $false }
}
if ($needsNode) {
    $toolchain = Join-Path $repoRoot "starters\hybrid\windows-toolchain.ps1"
    if (-not (Test-Path $toolchain)) { Write-Fail "starters\hybrid\windows-toolchain.ps1 not found (branch too old?)." }
    Write-Info "Installing the native toolchain (Node 24, corepack yarn) — this may prompt for admin ..."
    & $toolchain -SkipDefenderExclusion
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-Command "node")) {
        Write-Fail "Node is still missing after the toolchain setup. Open a NEW terminal (PATH refresh) and re-run this installer."
    }
}
Write-Info ("Node {0} ready" -f (& node -v))

corepack enable 2>$null | Out-Null
$yarnSpec = & node -p "require('./package.json').packageManager.split('+')[0]"
Write-Info "Activating $yarnSpec via corepack ..."
corepack prepare $yarnSpec --activate
Write-Info ("yarn {0} ready" -f (& yarn --version))

# --- container runtime -------------------------------------------------------
function Test-DockerReady {
    if (-not (Test-Command "docker")) { return $false }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-DockerReady)) {
    Write-WarnMsg "Docker with the compose v2 plugin is not available."
    if ($Runtime -eq "rancher") {
        Write-WarnMsg "Install Rancher Desktop (winget install SUSE.RancherDesktop, dockerd/moby backend), start it, then re-run."
    } elseif ((Test-Command "winget") -and -not $NonInteractive) {
        $answer = Read-Host "Install Docker Desktop via winget now? [y/N]"
        if ($answer -match '^y') {
            winget install --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
            Write-WarnMsg "Start Docker Desktop (first start may require logout/reboot), then re-run this installer."
        }
    } else {
        Write-WarnMsg "Install Docker Desktop (winget install Docker.DockerDesktop) or Rancher Desktop, start it, then re-run."
    }
    Write-WarnMsg "On a locked-down corporate machine, use the fully containerized enterprise launcher instead: starters\docker\windows\start-windows.bat"
    exit 2
}

# --- hand off to the shared pipeline ----------------------------------------
$forward = @()
if ($SkipDb) { $forward += "--skip-db" }
if ($SkipLlmPrompt) { $forward += "--skip-llm-prompt" }
if ($NonInteractive) { $forward += "--non-interactive" }
if ($NoStart) { $forward += "--no-start" }
& node starters/lib/install.mjs @forward
exit $LASTEXITCODE
