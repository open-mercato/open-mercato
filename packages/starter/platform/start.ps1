# Open Mercato starter — Windows bootstrap.
#
# The only job of this script is to guarantee Node 24 — WITHOUT admin rights,
# WITHOUT winget, and without touching machine state — then hand off to the
# cross-platform starter CLI (packages/starter/bin/om-start.mjs), which does
# everything else (doctor, corporate TLS trust, env/secrets, install, infra
# containers, database, supervised dev runtime).
#
# Managed-device design notes:
#   * Node is installed as a portable ZIP under %LOCALAPPDATA%\OpenMercato —
#     no elevation, no MSI, no PATH pollution beyond this session.
#   * Downloads go through Invoke-WebRequest (schannel), which trusts the
#     Windows certificate store — GPO-deployed corporate interception CAs work
#     out of the box.
#   * The script avoids .NET static calls where possible and degrades with a
#     clear message under AppLocker/WDAC Constrained Language Mode.
#   * WSL2 / Docker Desktop / Rancher Desktop are NEVER installed here — the
#     CLI detects and proposes them with an IT handout (doctor command).
#
# Inside a clone:  .\packages\starter\platform\start.ps1 [command] [flags]
# Standalone:      irm https://raw.githubusercontent.com/open-mercato/open-mercato/main/packages/starter/platform/start.ps1 | iex
#
# Env: OM_NODE_DIST_MIRROR — base URL mirroring https://nodejs.org/dist.

$ErrorActionPreference = 'Stop'
$NodeMajor = 24
$NodeDistBase = if ($env:OM_NODE_DIST_MIRROR) { $env:OM_NODE_DIST_MIRROR.TrimEnd('/') } else { 'https://nodejs.org/dist' }

function Write-Info([string]$Message) { Write-Host "[starter] $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "[starter] $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "[starter] $Message" -ForegroundColor Red; exit 1 }

# Two-tone Open Mercato wordmark (7-bit ASCII — safe on conhost/OEM code pages).
$LogoLeft = @(
  '  ___  ____  _____ _   _ ',
  ' / _ \|  _ \| ____| \ | |',
  '| | | | |_) |  _| |  \| |',
  '| |_| |  __/| |___| |\  |',
  ' \___/|_|   |_____|_| \_|'
)
$LogoRight = @(
  ' __  __ _____ ____   ____    _  _____ ___',
  '|  \/  | ____|  _ \ / ___|  / \|_   _/ _ \',
  '| |\/| |  _| | |_) | |     / _ \ | || | | |',
  '| |  | | |___|  _ <| |___ / ___ \| || |_| |',
  '|_|  |_|_____|_| \_\\____/_/   \_\_| \___/'
)
Write-Host ''
for ($i = 0; $i -lt $LogoLeft.Count; $i++) {
  Write-Host ("   {0}" -f $LogoLeft[$i]) -ForegroundColor DarkCyan -NoNewline
  Write-Host ("  {0}" -f $LogoRight[$i]) -ForegroundColor Cyan
}
Write-Host ''
Write-Host "   platform bootstrap - guarantees Node $NodeMajor (no admin), then hands off to the starter CLI" -ForegroundColor DarkGray
Write-Host ''

# Constrained Language Mode (AppLocker/WDAC): everything below sticks to
# cmdlets and core types, but surface the state early so failures make sense.
$languageMode = $ExecutionContext.SessionState.LanguageMode
if ("$languageMode" -ne 'FullLanguage') {
  Write-Warn "PowerShell runs in $languageMode (AppLocker/WDAC policy). Continuing with cmdlet-only operations; if this script is blocked, ask IT to allow it or run from an exempted path."
}

# PS 5.1 defaults can lack TLS 1.2 on older builds; a .NET static call is
# blocked under CLM, so guard it — Windows 10/11 22H2 negotiate TLS 1.2 anyway.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function Get-NodeMajor {
  # Scoped EAP: under 'Stop', PS 5.1 turns node's stderr (e.g. a NODE_OPTIONS
  # warning inherited from the environment) into a terminating error once
  # 2>$null wraps it — which would misreport a working Node as missing.
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $version = (& node -v) 2>$null
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ("$version" -match 'v(\d+)\.') { return [int]$Matches[1] }
  } catch { }
  return 0
}

function Find-PortableNode {
  $portableRoot = Join-Path $env:LOCALAPPDATA 'OpenMercato\node'
  if (-not (Test-Path $portableRoot)) { return $null }
  $candidate = Get-ChildItem -Path $portableRoot -Directory -Filter "node-v$NodeMajor.*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($candidate -and (Test-Path (Join-Path $candidate.FullName 'node.exe'))) { return $candidate.FullName }
  return $null
}

function Install-PortableNode {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  Write-Info "Resolving latest Node $NodeMajor release ..."
  $index = Invoke-RestMethod -Uri "$NodeDistBase/index.json" -UseBasicParsing
  $release = $index | Where-Object { $_.version -match "^v$NodeMajor\." } | Select-Object -First 1
  if (-not $release) { Fail "Could not resolve a Node $NodeMajor version from $NodeDistBase. Behind a proxy? Set HTTPS_PROXY, or point OM_NODE_DIST_MIRROR at an internal mirror." }
  $version = $release.version
  $zipName = "node-$version-win-$arch.zip"
  $portableRoot = Join-Path $env:LOCALAPPDATA 'OpenMercato\node'
  $tempDir = Join-Path $env:TEMP "open-mercato-starter"
  New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  $zipPath = Join-Path $tempDir $zipName

  Write-Info "Downloading $zipName (no admin required) ..."
  Invoke-WebRequest -Uri "$NodeDistBase/$version/$zipName" -OutFile $zipPath -UseBasicParsing

  Write-Info 'Verifying checksum ...'
  $shasums = (Invoke-WebRequest -Uri "$NodeDistBase/$version/SHASUMS256.txt" -UseBasicParsing).Content
  $expectedLine = $shasums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
  if (-not $expectedLine) { Fail "SHASUMS256.txt has no entry for $zipName." }
  $expected = ($expectedLine -split '\s+')[0].Trim().ToLowerInvariant()
  $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { Fail "Checksum verification FAILED for $zipName (expected $expected, got $actual). Refusing to continue." }

  Write-Info "Extracting to $portableRoot ..."
  Expand-Archive -Path $zipPath -DestinationPath $portableRoot -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  $installed = Find-PortableNode
  if (-not $installed) { Fail 'Portable Node extraction failed.' }
  return $installed
}

if ((Get-NodeMajor) -ne $NodeMajor) {
  $portable = Find-PortableNode
  if (-not $portable) { $portable = Install-PortableNode }
  $env:Path = "$portable;$env:Path"
  Write-Warn "Using portable Node from $portable (PATH updated for this session)."
  Write-Warn "Persist it for your own shells:  setx PATH `"$portable;%PATH%`""
}
if ((Get-NodeMajor) -ne $NodeMajor) { Fail "Node $NodeMajor is required (found: $(try { & node -v } catch { 'none' }))." }
Write-Info "Node $(& node -v) ready"

# Locate the repo: walk up from this script first (in-clone use), then from
# the working directory (irm-standalone use).
function Find-RepoRoot([string]$StartDir) {
  $dir = $StartDir
  while ($dir -and (Test-Path $dir)) {
    if (Test-Path (Join-Path $dir 'starters\docker\compose.infra.yml')) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { return $null }
    $dir = $parent
  }
  return $null
}

$repoRoot = $null
if ($PSScriptRoot) { $repoRoot = Find-RepoRoot $PSScriptRoot }
if (-not $repoRoot) { $repoRoot = Find-RepoRoot (Get-Location).Path }

if ($repoRoot) {
  & node (Join-Path $repoRoot 'packages\starter\bin\om-start.mjs') @args
  exit $LASTEXITCODE
}

# Standalone: no clone yet — npx fetches the published starter, which clones
# and continues. --use-system-ca keeps npm's TLS working behind corporate
# interception (the GPO-deployed CA lives in the Windows store).
Write-Info 'No checkout found — bootstrapping via npx @open-mercato/starter ...'
$env:NODE_OPTIONS = "$($env:NODE_OPTIONS) --use-system-ca".Trim()
& npx --yes '@open-mercato/starter' @args
exit $LASTEXITCODE
