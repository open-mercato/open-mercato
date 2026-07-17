# One-command Windows launcher for the fully containerized Open Mercato dev
# stack (app :3000, mcp :3001, opencode :4096, postgres/redis/meilisearch).
#
# Designed for a clean Windows machine: installs Git and a container runtime,
# enables WSL2 (with a pinned GitHub-release fallback when the Store is
# blocked), handles the reboot-and-resume cycle, clones the repo when run
# standalone, generates .env secrets, optionally prompts for an LLM provider
# API key, starts docker compose, waits for health, and prints a summary.
# Every step is idempotent and driven by live probes, so re-running the script
# (or any launcher .bat) is always safe.
#
# Entry points: start-windows.bat auto-detects the runtime;
# start-windows-rancher.bat / start-windows-docker.bat force one (they pass
# -Runtime). Admin is requested ONLY for what is actually missing: with WSL2
# and a runtime pre-installed (or Rancher installed per-user by this script)
# no elevation happens at all.
#
# Unlike starters/hybrid/windows-toolchain.ps1 (native toolchain: Node, Build
# Tools), this launcher needs NO Node.js on the host. Pass
# -IncludeNativeToolchain to additionally run the native toolchain setup script.
#
# Exit codes: 0 = success, 10 = reboot required (resume via RunOnce or re-run),
# 1 = failure.

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Status,
    [switch]$Logs,
    [switch]$Reset,
    [switch]$Yes,

    [string]$CloneRoot = $env:USERPROFILE,
    [string]$RepoName = "open-mercato",
    [string]$RepoUrl = "https://github.com/open-mercato/open-mercato.git",
    [string]$Branch = "main",

    [switch]$NonInteractive,
    [switch]$DryRun,
    [switch]$SkipInstall,
    [switch]$SkipLlmPrompt,
    [switch]$SkipDefenderExclusion,
    [switch]$IncludeNativeToolchain,
    [switch]$Rebuild,
    [switch]$NoAdmin,
    # Downgrades the RAM/disk preflight failures to warnings (small machines
    # that accept the OOM / out-of-disk risk).
    [switch]$SkipResourceCheck,
    # Container runtime: 'auto' uses whatever is already installed (Docker
    # Desktop or Rancher Desktop) and installs Docker Desktop on clean machines;
    # 'rancher' prefers/installs Rancher Desktop (common where Docker Desktop
    # licensing is not permitted); 'docker' forces Docker Desktop.
    [ValidateSet("auto", "docker", "rancher")][string]$Runtime = "auto",
    [int]$TimeoutMinutes = 30,
    [string]$LogPath = "",

    # Internal parameters (used by the launcher and self-relaunches)
    [string]$LauncherPath = "",
    [switch]$Elevated,
    [string]$RepoPathForExclusion = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:ComposeFile = "starters\docker\compose.fullapp.dev.yml"
# Canonical compose invocation prefix for user-facing hints. --project-directory
# keeps .env interpolation and relative paths anchored at the repo root now that
# the compose files live under starters\docker\.
$script:ComposeCmd = "docker compose --project-directory . -f $script:ComposeFile"
$script:RunOnceKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
$script:RunOnceName = "OpenMercatoDevSetup"
$script:RestartRequired = $false
$script:Warnings = [System.Collections.Generic.List[string]]::new()
$script:TranscriptStarted = $false
$script:ResolvedLogPath = $null
$script:RepoRoot = $null
$script:StepNumber = 0
# Compose invocation fallback: $null means the `docker compose` CLI plugin
# works; otherwise the full path of a standalone docker-compose binary that
# every compose call must use instead (see Resolve-ComposeExe).
$script:ComposeExe = $null
$script:ComposeProbed = $false
$script:LastComposeOutput = ""
$script:TlsRepairAttempted = $false
# WSL version installed from the microsoft/WSL GitHub releases when
# `wsl --update` cannot reach the Microsoft Store (enterprise images).
# Bump deliberately - the asset name pattern is wsl.<version>.0.<arch>.msi.
$script:WslPinnedVersion = "2.7.10"
# Host-port defaults; refreshed from the repo-root .env (compose interpolation
# source) once the repo location is known, so the launcher follows the same
# port overrides the compose file honors.
$script:AppPort = 3000
$script:SplashPort = 4000
$script:McpPort = 3001
$script:OpencodePort = 4096
$script:KeycloakPort = 8080

if ($env:CI -eq "true") { $NonInteractive = $true }

# ---------------------------------------------------------------------------
# Output helpers (mirrors starters/hybrid/windows-toolchain.ps1 conventions)
# ---------------------------------------------------------------------------

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
    Write-Host (" {0}" -f $Message) -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
}

function Write-StepHeader {
    # Second argument (optional): a plain-language expectation ("takes ~2 min",
    # "instant") so users on slow corporate machines know what "long" means
    # BEFORE a step goes quiet.
    param([string]$Message, [string]$Expected = "")
    $script:StepNumber++
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
    Write-Host (" STEP {0} " -f $script:StepNumber) -BackgroundColor DarkCyan -ForegroundColor Black -NoNewline
    Write-Host ("  {0}" -f $Message) -ForegroundColor Cyan
    if ($Expected) {
        Write-Host ("          Expected: {0}" -f $Expected) -ForegroundColor DarkGray
    }
}

# Two-tone wordmark, figlet "standard". Pure 7-bit ASCII on purpose: PS 5.1
# in conhost on OEM code pages garbles Unicode box drawing, and per-line
# -ForegroundColor needs no ANSI/VT support. Left rows are padded to a fixed
# width so the right half always aligns.
$script:LogoLeft = @(
    '  ___  ____  _____ _   _ ',
    ' / _ \|  _ \| ____| \ | |',
    '| | | | |_) |  _| |  \| |',
    '| |_| |  __/| |___| |\  |',
    ' \___/|_|   |_____|_| \_|'
)
$script:LogoRight = @(
    ' __  __ _____ ____   ____    _  _____ ___',
    '|  \/  | ____|  _ \ / ___|  / \|_   _/ _ \',
    '| |\/| |  _| | |_) | |     / _ \ | || | | |',
    '| |  | | |___|  _ <| |___ / ___ \| || |_| |',
    '|_|  |_|_____|_| \_\\____/_/   \_\_| \___/'
)

function Show-Banner {
    Write-Host ""
    for ($i = 0; $i -lt $script:LogoLeft.Count; $i++) {
        Write-Host ("   {0}" -f $script:LogoLeft[$i]) -ForegroundColor DarkCyan -NoNewline
        Write-Host ("  {0}" -f $script:LogoRight[$i]) -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "   One-command development environment for Windows" -ForegroundColor White
    $runtimeLabel = switch ($Runtime) {
        "rancher" { "Rancher Desktop (pinned)" }
        "docker" { "Docker Desktop (pinned)" }
        default { "auto-detect (Docker Desktop / Rancher Desktop)" }
    }
    if ($script:RepoRoot) {
        Write-Host ("   Repo: {0}" -f $script:RepoRoot) -ForegroundColor DarkGray
        Write-Host ("   Runtime: {0}" -f $runtimeLabel) -ForegroundColor DarkGray
        Write-Host ("   App :{0} | Splash :{1} | MCP :{2} | OpenCode :{3} | Keycloak :{4}" -f $script:AppPort, $script:SplashPort, $script:McpPort, $script:OpencodePort, $script:KeycloakPort) -ForegroundColor DarkGray
    } else {
        Write-Host ("   Standalone mode: will clone into {0}" -f (Join-Path $CloneRoot $RepoName)) -ForegroundColor DarkGray
        Write-Host ("   Runtime: {0}" -f $runtimeLabel) -ForegroundColor DarkGray
    }
}

function Show-MiniBanner {
    # Compact one-line brand for secondary actions, the elevated child window,
    # and anywhere the full logo would be noise.
    param([Parameter(Mandatory = $true)][string]$Action)
    Write-Host ""
    Write-Host "  OPEN" -ForegroundColor DarkCyan -NoNewline
    Write-Host " MERCATO" -ForegroundColor Cyan -NoNewline
    Write-Host (" | {0}" -f $Action) -ForegroundColor White
    Write-Host ("  " + ("-" * 74)) -ForegroundColor DarkGray
}

$script:SpinnerFrames = @("|", "/", "-", "\")
$script:SpinnerIndex = 0
function Write-WaitTick {
    # One-line animated status for polling loops: spinner + elapsed + message,
    # redrawn in place so the console shows life instead of a frozen prompt.
    param([Parameter(Mandatory = $true)][datetime]$StartedAt, [string]$Message)
    $frame = $script:SpinnerFrames[$script:SpinnerIndex % $script:SpinnerFrames.Count]
    $script:SpinnerIndex++
    $elapsed = "{0:mm\:ss}" -f ((Get-Date) - $StartedAt)
    Write-Host ("`r{0} [{1}] " -f $frame, $elapsed) -ForegroundColor Cyan -NoNewline
    Write-Host ("{0}   " -f $Message) -ForegroundColor Gray -NoNewline
}

function Write-Info {
    # Neutral progress line: gray, with a dim timestamp. Yellow is reserved
    # for warnings so it keeps meaning "attention".
    param([string]$Message)
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] " -ForegroundColor DarkGray -NoNewline
    Write-Host $Message -ForegroundColor Gray
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message -ForegroundColor Gray
}

function Write-Warn {
    param([string]$Message)
    Write-Warning $Message
    [void]$script:Warnings.Add($Message)
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    throw $Message
}

function Initialize-Logging {
    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        $logDirectory = Join-Path $env:TEMP "open-mercato-setup"
        New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
        $script:ResolvedLogPath = Join-Path $logDirectory ("start-dev-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    } else {
        $parent = Split-Path -Parent $LogPath
        if ($parent) { New-Item -Path $parent -ItemType Directory -Force | Out-Null }
        $script:ResolvedLogPath = $LogPath
    }
    try {
        Start-Transcript -Path $script:ResolvedLogPath -Force | Out-Null
        $script:TranscriptStarted = $true
    } catch {
        # Transcript can fail in constrained hosts; logging is best-effort.
    }
}

function Complete-Logging {
    if ($script:TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
        $script:TranscriptStarted = $false
    }
}

function Pause-OnFailure {
    if (-not $NonInteractive -and $Host.Name -match "ConsoleHost") {
        Read-Host "Press Enter to close" | Out-Null
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-CommandAvailable {
    param([Parameter(Mandatory = $true)][string]$CommandName)
    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Invoke-NativeQuiet {
    # PS 5.1 landmine: redirecting a native command's stderr while
    # $ErrorActionPreference='Stop' promotes the first stderr line to a
    # TERMINATING error. Probes that should simply return an exit code would
    # crash the whole setup instead - e.g. `docker info` printing "error during
    # connect" to stderr while the engine is still starting. This wrapper runs
    # the command under 'Continue', discards all output, and returns the exit
    # code (1 when the command cannot start at all).
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Arguments = @())
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } catch {
        return 1
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-NativeCapture {
    # Same stderr guard as Invoke-NativeQuiet, but returns stdout as a string
    # (empty string when the command fails to start).
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Arguments = @())
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return (& $Command @Arguments 2>$null | Out-String)
    } catch {
        return ""
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-NativeVisible {
    # Same stderr guard, but streams the command's full output to the console
    # (installers and git clone report progress on stderr). This also protects
    # against the second PS 5.1 promotion trigger: when powershell.exe's OWN
    # stderr is redirected (e.g. `start-windows.bat > log.txt 2>&1`), bare
    # native stderr becomes terminating even without in-script redirection.
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Arguments = @())
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command @Arguments 2>&1 | Out-Host
        return $LASTEXITCODE
    } catch {
        return 1
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------------------
# Repo detection / secrets
# ---------------------------------------------------------------------------

function Resolve-RepoRoot {
    $candidate = $null
    if ($PSScriptRoot -and ($PSScriptRoot -match "\\starters\\docker\\windows$")) {
        $candidate = Resolve-Path (Join-Path $PSScriptRoot "..\..\..") -ErrorAction SilentlyContinue
    }
    if ($candidate -and (Test-Path (Join-Path $candidate $script:ComposeFile)) -and (Test-Path (Join-Path $candidate "package.json"))) {
        return $candidate.Path
    }
    return $null
}

function Get-SecretHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return (([System.BitConverter]::ToString($buffer)) -replace "-", "").ToLower()
}

function Get-SecretFingerprint {
    param([string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))
        $hex = ([System.BitConverter]::ToString($hash)) -replace "-", ""
        return ("sha256:{0}..., {1} chars" -f $hex.Substring(0, 8).ToLower(), $Value.Length)
    } finally { $sha.Dispose() }
}

# ---------------------------------------------------------------------------
# HTTP probes
# ---------------------------------------------------------------------------

function Test-HttpListening {
    # Any HTTP answer (including 4xx/5xx) means something is listening.
    param([Parameter(Mandatory = $true)][string]$Url, [int]$TimeoutSec = 5)
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec | Out-Null
        return $true
    } catch {
        if ($_.Exception.Response) { return $true }
        return $false
    }
}

function Test-HttpOk {
    param([Parameter(Mandatory = $true)][string]$Url, [int]$TimeoutSec = 5)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Prerequisite probes + elevated install phase
# ---------------------------------------------------------------------------

function Test-VirtualizationEnabled {
    try {
        $computerSystem = Get-CimInstance Win32_ComputerSystem
        if ($computerSystem.HypervisorPresent) { return $true }
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        if ($cpu -and $cpu.VirtualizationFirmwareEnabled) { return $true }
        return $false
    } catch {
        return $true # Probe failure should not block; Docker will surface it.
    }
}

function Test-WingetAvailable { return (Test-CommandAvailable "winget") }

# ---------------------------------------------------------------------------
# Direct-download fallbacks (winget / App Installer is missing on Windows LTSC,
# Server SKUs, and many locked-down corporate images — and installing winget
# itself fails there on MSIX framework dependencies, so it is NEVER required).
# Git and Docker Desktop publish stable official installers we fetch and run
# silently; on corporate devices where downloads are blocked, IT can pre-seed
# the official installers into an `installers` folder (see
# Resolve-LocalInstaller) and no network access is needed at all.
# ---------------------------------------------------------------------------

$script:MachineArch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }

function Test-FileMagic {
    # Validates that a downloaded/seeded file is what it claims to be. Corporate
    # proxies commonly answer blocked downloads with an HTML page + HTTP 200 —
    # feeding that to an installer produces baffling errors, so check the bytes.
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet("exe", "msi", "zip")][string]$FileType
    )
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $buffer = New-Object byte[] 8
            if ($stream.Read($buffer, 0, 8) -lt 4) { return $false }
            switch ($FileType) {
                "exe" { return ($buffer[0] -eq 0x4D -and $buffer[1] -eq 0x5A) }                                  # MZ
                "msi" { return ($buffer[0] -eq 0xD0 -and $buffer[1] -eq 0xCF -and $buffer[2] -eq 0x11 -and $buffer[3] -eq 0xE0) } # OLE2
                "zip" { return ($buffer[0] -eq 0x50 -and $buffer[1] -eq 0x4B) }                                  # PK
            }
        } finally { $stream.Close() }
    } catch { return $false }
    return $false
}

function Resolve-LocalInstaller {
    # Offline/corporate path: look for a pre-seeded official installer before
    # downloading. Search order: OM_INSTALLERS_DIR env var, an `installers`
    # folder in the repo root, next to the launcher .bat, and next to this
    # script. IT can drop the official installers there (Git, Docker Desktop
    # or Rancher Desktop, WSL) and the launcher never needs to download
    # anything.
    param(
        [Parameter(Mandatory = $true)][string[]]$Patterns,
        [Parameter(Mandatory = $true)][ValidateSet("exe", "msi", "zip")][string]$FileType
    )
    $candidateDirs = New-Object System.Collections.Generic.List[string]
    if ($env:OM_INSTALLERS_DIR) { $candidateDirs.Add($env:OM_INSTALLERS_DIR) }
    if ($script:RepoRoot) { $candidateDirs.Add((Join-Path $script:RepoRoot "installers")) }
    if ($LauncherPath) { $candidateDirs.Add((Join-Path (Split-Path -Parent $LauncherPath) "installers")) }
    if ($PSScriptRoot) {
        $candidateDirs.Add((Join-Path $PSScriptRoot "installers"))
        # In-repo layout: starters\docker\windows -> repo root three levels up.
        $repoCandidate = Join-Path $PSScriptRoot "..\..\..\installers"
        $candidateDirs.Add($repoCandidate)
    }
    foreach ($dir in ($candidateDirs | Select-Object -Unique)) {
        if (-not (Test-Path $dir)) { continue }
        foreach ($pattern in $Patterns) {
            # Check every match: a stale/corrupt file must not shadow a valid one.
            foreach ($candidate in @(Get-ChildItem -Path $dir -Filter $pattern -File -ErrorAction SilentlyContinue)) {
                if (Test-FileMagic -Path $candidate.FullName -FileType $FileType) {
                    Write-Ok "Using pre-seeded installer: $($candidate.FullName)"
                    return $candidate.FullName
                }
            }
        }
    }
    return $null
}

function Get-RemoteFile {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [string]$DisplayName = "file",
        [ValidateSet("exe", "msi", "zip")][string]$FileType = "exe",
        [long]$MinBytes = 1MB,
        [int]$Retries = 3
    )
    # TLS 1.2 minimum; add TLS 1.3 when the underlying .NET supports it.
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 -bor 12288
    } catch {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }
    $extraArgs = @{}
    if ($env:HTTPS_PROXY) {
        $extraArgs.Proxy = $env:HTTPS_PROXY
        $extraArgs.ProxyUseDefaultCredentials = $true
    }

    $lastError = $null
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        Write-Info "Downloading $DisplayName (attempt $attempt/$Retries)..."
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers @{ "User-Agent" = "open-mercato-setup" } @extraArgs
            if ((Test-Path $OutFile) -and (Get-Item $OutFile).Length -ge $MinBytes -and (Test-FileMagic -Path $OutFile -FileType $FileType)) {
                # Remove Mark-of-the-Web so SmartScreen/AV policy cannot block
                # the silent install of a file we just verified byte-wise.
                Unblock-File -Path $OutFile -ErrorAction SilentlyContinue
                return $true
            }
            $lastError = "downloaded file failed validation (too small or not a valid $FileType - a proxy may have answered with an HTML block page)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Remove-Item $OutFile -ErrorAction SilentlyContinue
        if ($attempt -lt $Retries) { Start-Sleep -Seconds ([Math]::Min(15, 5 * $attempt)) }
    }

    Write-Warn "Download of $DisplayName failed after $Retries attempts: $lastError"
    Write-Warn "Corporate network? Options: (a) set HTTPS_PROXY for this session, (b) ask IT to allow the download, or (c) place the official installer in an 'installers' folder next to start-windows.bat (or set OM_INSTALLERS_DIR) and re-run - the launcher uses pre-seeded installers without any network access."
    return $false
}

function Install-GitDirect {
    $archPattern = if ($script:MachineArch -eq "arm64") { "Git-*-arm64.exe" } else { "Git-*-64-bit.exe" }
    $installer = Resolve-LocalInstaller -Patterns @($archPattern) -FileType exe
    if (-not $installer) {
        # Resolve the latest release via the GitHub API; on failure (rate limit,
        # blocked endpoint) fall back to a pinned known-good release URL.
        $assetRegex = if ($script:MachineArch -eq "arm64") { '^Git-.*-arm64\.exe$' } else { '^Git-.*-64-bit\.exe$' }
        $pinnedUrl = if ($script:MachineArch -eq "arm64") {
            "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-arm64.exe"
        } else {
            "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
        }
        $assetUrl = $null
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -UseBasicParsing -Headers @{ "User-Agent" = "open-mercato-setup" }
            $asset = $release.assets | Where-Object { $_.name -match $assetRegex } | Select-Object -First 1
            if ($asset) { $assetUrl = $asset.browser_download_url }
        } catch {
            Write-Warn "Could not query the latest Git release ($($_.Exception.Message)) - using a pinned known-good version instead."
        }
        if (-not $assetUrl) { $assetUrl = $pinnedUrl }
        $installer = Join-Path $env:TEMP "git-for-windows-setup.exe"
        if (-not (Get-RemoteFile -Url $assetUrl -OutFile $installer -DisplayName "Git for Windows" -FileType exe -MinBytes 20MB)) {
            Write-Fail "Git could not be downloaded. Install it manually from https://git-scm.com/download/win (or pre-seed the installer, see above) and re-run."
        }
    }
    Write-Info "Installing Git (silent)..."
    $proc = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/NORESTART', '/SP-', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/CLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS' -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Git installer exited with code $($proc.ExitCode). Install Git manually from https://git-scm.com/download/win and re-run." }
}

function Install-DockerDesktopDirect {
    $installer = Resolve-LocalInstaller -Patterns @("Docker Desktop Installer.exe", "DockerDesktopInstaller.exe", "Docker*Installer*.exe") -FileType exe
    if (-not $installer) {
        $installer = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
        $url = "https://desktop.docker.com/win/main/$script:MachineArch/Docker%20Desktop%20Installer.exe"
        if (-not (Get-RemoteFile -Url $url -OutFile $installer -DisplayName "Docker Desktop (~500 MB)" -FileType exe -MinBytes 100MB)) {
            Write-Fail "Docker Desktop could not be downloaded. Install it manually from https://www.docker.com/products/docker-desktop/ (or pre-seed the installer, see above) and re-run."
        }
    }
    Write-Info "Installing Docker Desktop (silent)..."
    $proc = Start-Process -FilePath $installer -ArgumentList 'install', '--quiet', '--accept-license', '--backend=wsl-2' -Wait -PassThru
    # 0 = success; 3010 = success but reboot required.
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        Write-Fail "Docker Desktop installer exited with code $($proc.ExitCode). Install manually from https://www.docker.com/products/docker-desktop/ and re-run."
    }
}

function Install-GitViaBestMethod {
    param([bool]$HasWinget)
    if ($HasWinget) {
        Write-Info "Installing Git via winget..."
        $wingetExit = Invoke-NativeVisible "winget" @("install", "--id", "Git.Git", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
        if ($wingetExit -eq 0) { [void](Test-GitInstalled); return }
        Write-Warn "winget could not install Git (exit $wingetExit) - falling back to a direct download."
    } else {
        Write-Info "winget unavailable - installing Git via direct download..."
    }
    Install-GitDirect
    [void](Test-GitInstalled)
}

function Install-DockerViaBestMethod {
    param([bool]$HasWinget)
    if ($HasWinget) {
        Write-Info "Installing Docker Desktop via winget (this downloads ~500 MB)..."
        $wingetExit = Invoke-NativeVisible "winget" @("install", "--id", "Docker.DockerDesktop", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--override", "install --quiet --accept-license --backend=wsl-2")
        if ($wingetExit -eq 0) { return }
        Write-Warn "winget could not install Docker Desktop (exit $wingetExit) - falling back to a direct download."
    } else {
        Write-Info "winget unavailable - installing Docker Desktop via direct download..."
    }
    Install-DockerDesktopDirect
}

function Test-Wsl2KernelPresent {
    # Locale-independent probes only (exit codes / file presence - wsl.exe
    # output is localized). Three ways a kernel is already there:
    # 1. Modern WSL (Store / MSI app distribution) bundles + self-manages its
    #    kernel; only it understands `wsl --version` (legacy inbox wsl.exe
    #    rejects the flag).
    # 2. Legacy inbox WSL with the standalone kernel MSI installed: the kernel
    #    lives at System32\lxss\tools\kernel.
    # 3. Functional check: `wsl --set-default-version 2` succeeds only when a
    #    usable WSL2 kernel exists.
    if (-not (Test-CommandAvailable "wsl")) { return $false }
    if ((Invoke-NativeQuiet "wsl" @("--version")) -eq 0) { return $true }
    if (Test-Path (Join-Path $env:SystemRoot "System32\lxss\tools\kernel")) { return $true }
    return ((Invoke-NativeQuiet "wsl" @("--set-default-version", "2")) -eq 0)
}

function Install-WslFromGitHubRelease {
    # `wsl --update` pulls from the Microsoft Store, which enterprise images
    # routinely block — that dead end used to leave people installing WSL by
    # hand. The MSI from the microsoft/WSL GitHub releases is the full modern
    # WSL (bundled kernel, no Store involved); pinned to a known-good version
    # so every machine gets the same bits. Pre-seed it in `installers\` to
    # skip the download entirely (see Resolve-LocalInstaller).
    $arch = if ($script:MachineArch -eq "arm64") { "arm64" } else { "x64" }
    $assetName = "wsl.$($script:WslPinnedVersion).0.$arch.msi"
    $installer = Resolve-LocalInstaller -Patterns @($assetName, "wsl.*.$arch.msi") -FileType msi
    if (-not $installer) {
        $installer = Join-Path $env:TEMP $assetName
        $url = "https://github.com/microsoft/WSL/releases/download/$($script:WslPinnedVersion)/$assetName"
        if (-not (Get-RemoteFile -Url $url -OutFile $installer -DisplayName "WSL $($script:WslPinnedVersion) (~250 MB)" -FileType msi -MinBytes 100MB)) {
            return $false
        }
    }
    Write-Info "Installing WSL $($script:WslPinnedVersion) (silent)..."
    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList '/i', "`"$installer`"", '/qn', '/norestart' -Wait -PassThru
    if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
        if ($proc.ExitCode -eq 3010) { $script:RestartRequired = $true }
        Write-Ok "WSL $($script:WslPinnedVersion) installed"
        return $true
    }
    Write-Warn "WSL $($script:WslPinnedVersion) installer exited with code $($proc.ExitCode)."
    return $false
}

function Ensure-Wsl2Kernel {
    # Ensure a usable WSL2 kernel, cheapest path first: already present →
    # `wsl --update` (needs Store access) → pinned GitHub-release MSI (modern
    # WSL, no Store) → legacy standalone kernel MSI. Installing pre-reboot just
    # stages the files; the enabled features activate after the restart.
    # Best-effort throughout, so a failure here warns, never aborts.
    if (Test-Wsl2KernelPresent) {
        Write-Ok "WSL2 kernel already present - skipping download"
        return
    }
    if (Test-CommandAvailable "wsl") {
        [void](Invoke-NativeQuiet "wsl" @("--update"))
        if (Test-Wsl2KernelPresent) {
            Write-Ok "WSL2 kernel installed via wsl --update"
            return
        }
        Write-Info "wsl --update did not complete (Microsoft Store blocked?) - installing WSL $($script:WslPinnedVersion) from its GitHub release instead."
    }
    if (Install-WslFromGitHubRelease) { return }
    $kernelName = if ($script:MachineArch -eq "arm64") { "wsl_update_arm64.msi" } else { "wsl_update_x64.msi" }
    $kernelMsi = Resolve-LocalInstaller -Patterns @($kernelName, "wsl_update*.msi") -FileType msi
    if (-not $kernelMsi) {
        $kernelMsi = Join-Path $env:TEMP $kernelName
        if (-not (Get-RemoteFile -Url "https://wslstorestorage.blob.core.windows.net/wslblob/$kernelName" -OutFile $kernelMsi -DisplayName "WSL2 kernel" -FileType msi -MinBytes 2MB)) {
            Write-Warn "WSL could not be installed automatically. Download wsl.$($script:WslPinnedVersion).0.x64.msi from https://github.com/microsoft/WSL/releases/tag/$($script:WslPinnedVersion) (or ask IT to), install it, then re-run the launcher - or pre-seed the MSI into an 'installers' folder next to the launcher."
            return
        }
    }
    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList '/i', "`"$kernelMsi`"", '/qn', '/norestart' -Wait -PassThru
    if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
        Write-Ok "WSL2 kernel installed"
    } else {
        Write-Warn "WSL2 kernel installer exited with code $($proc.ExitCode). Install WSL manually from https://github.com/microsoft/WSL/releases/tag/$($script:WslPinnedVersion), then re-run the launcher."
    }
}

function Test-GitInstalled {
    if (Test-CommandAvailable "git") { return $true }
    $candidates = @(
        (Join-Path ${env:ProgramFiles} "Git\cmd\git.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Git\cmd\git.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $env:Path = (Split-Path $candidate) + ";" + $env:Path
            return $true
        }
    }
    return $false
}

function Test-WslFeaturesEnabled {
    if (Test-IsAdministrator) {
        try {
            $wsl = Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux"
            $vmp = Get-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform"
            return ($wsl.State -eq "Enabled" -and $vmp.State -eq "Enabled")
        } catch {}
    }
    # Unelevated probe: modern Windows ships a System32 wsl.exe stub even when
    # the optional features are disabled, so existence alone is meaningless —
    # `wsl --status` only succeeds on a working WSL installation.
    if (-not (Test-CommandAvailable "wsl")) { return $false }
    return ((Invoke-NativeQuiet "wsl" @("--status")) -eq 0)
}

function Test-DockerDesktopInstalled {
    return (Test-Path (Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"))
}

function Get-RancherDesktopExe {
    # Rancher Desktop installs machine-wide or per-user (the per-user MSI works
    # WITHOUT admin - relevant where Docker Desktop is not permitted).
    $candidates = @(
        (Join-Path ${env:ProgramFiles} "Rancher Desktop\Rancher Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Rancher Desktop\Rancher Desktop.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Test-RancherDesktopInstalled {
    return ($null -ne (Get-RancherDesktopExe))
}

function Add-RancherBinToPath {
    # Rancher Desktop puts docker / docker compose / rdctl into ~\.rd\bin; a
    # fresh shell (or first run before re-logon) may not have it on PATH yet.
    # Only prepend when no docker CLI is available: on dual-install machines
    # (Docker Desktop + Rancher) shadowing Docker Desktop's CLI with Rancher's
    # would silently change which binary every later call uses.
    $rdBin = Join-Path $env:USERPROFILE ".rd\bin"
    if ((Test-Path $rdBin) -and -not (Test-CommandAvailable "docker") -and (($env:Path -split ";") -notcontains $rdBin)) {
        $env:Path = "$rdBin;$env:Path"
    }
}

function Test-ContainerRuntimeInstalled {
    # Any runtime that gives us a working `docker` CLI + engine is fine: Docker
    # Desktop, Rancher Desktop (dockerd/moby), or something IT-managed that
    # already answers `docker info`.
    if (Test-DockerDesktopInstalled) { return $true }
    if (Test-RancherDesktopInstalled) { return $true }
    Add-RancherBinToPath
    return (Test-CommandAvailable "docker")
}

function Test-RuntimeInstallNeeded {
    # A forced runtime (-Runtime docker|rancher, i.e. the start-windows-docker /
    # start-windows-rancher launchers) must be present as that app; 'auto'
    # accepts anything that yields a docker CLI. Either way, an engine that
    # ALREADY answers `docker info` never triggers an install - the enterprise
    # no-touch case where IT pre-provisioned the machine.
    if ($Runtime -eq "rancher") {
        if (Test-RancherDesktopInstalled) { return $false }
    } elseif ($Runtime -eq "docker") {
        if (Test-DockerDesktopInstalled) { return $false }
    } elseif (Test-ContainerRuntimeInstalled) { return $false }
    return (-not (Test-DockerEngineReady))
}

function Test-DockerEngineReady {
    Add-RancherBinToPath
    if (-not (Test-CommandAvailable "docker")) { return $false }
    return ((Invoke-NativeQuiet "docker" @("info")) -eq 0)
}

function Select-WorkingDockerContext {
    # The docker CLI keeps a sticky "current context", so a leftover selection
    # (e.g. desktop-linux from an old Docker Desktop install) makes `docker
    # info` poll a dead pipe while the engine that IS running never gets
    # probed. Try each candidate context explicitly and pin the CLI to the
    # first one whose engine answers.
    param([Parameter(Mandatory = $true)][string[]]$Candidates)
    Add-RancherBinToPath
    if (-not (Test-CommandAvailable "docker")) { return $false }
    foreach ($candidate in $Candidates) {
        if ((Invoke-NativeQuiet "docker" @("--context", $candidate, "info")) -eq 0) {
            [void](Invoke-NativeQuiet "docker" @("context", "use", $candidate))
            return $true
        }
    }
    return $false
}

function Install-RancherDesktopDirect {
    # Rancher's MSI is dual-mode: machine-wide (needs admin) or per-user
    # (-PerUser, no admin) - the per-user mode is how enterprise accounts that
    # cannot elevate still get a runtime, provided WSL2 is already in place.
    param([switch]$PerUser)
    $installer = Resolve-LocalInstaller -Patterns @("Rancher.Desktop.Setup.*.msi", "Rancher*Desktop*.msi") -FileType msi
    if (-not $installer) {
        $assetUrl = $null
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/rancher-sandbox/rancher-desktop/releases/latest" -UseBasicParsing -Headers @{ "User-Agent" = "open-mercato-setup" }
            $asset = $release.assets | Where-Object { $_.name -match '^Rancher\.Desktop\.Setup\..*\.msi$' } | Select-Object -First 1
            if ($asset) { $assetUrl = $asset.browser_download_url }
        } catch {
            Write-Warn "Could not query the latest Rancher Desktop release ($($_.Exception.Message)) - using a pinned known-good version instead."
        }
        if (-not $assetUrl) { $assetUrl = "https://github.com/rancher-sandbox/rancher-desktop/releases/download/v1.16.0/Rancher.Desktop.Setup.1.16.0.msi" }
        $installer = Join-Path $env:TEMP "RancherDesktopSetup.msi"
        if (-not (Get-RemoteFile -Url $assetUrl -OutFile $installer -DisplayName "Rancher Desktop (~600 MB)" -FileType msi -MinBytes 100MB)) {
            Write-Fail "Rancher Desktop could not be downloaded. Install it manually from https://rancherdesktop.io (or pre-seed the installer) and re-run."
        }
    }
    $msiArgs = @('/i', "`"$installer`"", '/qn', '/norestart')
    if ($PerUser) { $msiArgs += @('MSIINSTALLPERUSER=1', 'ALLUSERS=2') }
    Write-Info ("Installing Rancher Desktop (silent{0})..." -f $(if ($PerUser) { ", per-user - no administrator rights" } else { "" }))
    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        Write-Fail "Rancher Desktop installer exited with code $($proc.ExitCode). Install manually from https://rancherdesktop.io and re-run."
    }
    Write-Info "Rancher Desktop installed. It will be started with the dockerd (moby) engine so `docker compose` works."
}

function Invoke-ElevatedInstallPhase {
    # Runs inside the elevated child process (-Elevated). Performs only the
    # admin-required work, then exits: 0 = done, 10 = reboot required.
    Show-MiniBanner "Administrator install phase (this elevated window closes when done)"

    # winget is a fast path when present; when it is not (LTSC / Server /
    # locked-down images) we fall back to direct downloads of the official
    # installers, so the App Installer is no longer a hard requirement.
    $hasWinget = Test-WingetAvailable
    if (-not $hasWinget) {
        Write-Warn "winget / App Installer is not available - Git and Docker Desktop will be installed via direct download instead."
    }

    if (-not (Test-GitInstalled)) {
        Install-GitViaBestMethod -HasWinget $hasWinget
    }
    if (Test-CommandAvailable "git") {
        [void](Invoke-NativeQuiet "git" @("config", "--global", "core.autocrlf", "input"))
        Write-Ok "Git ready"
    }

    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux"
    $vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform"
    if ($wslFeature.State -ne "Enabled") {
        Write-Info "Enabling Windows feature Microsoft-Windows-Subsystem-Linux..."
        Enable-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux" -All -NoRestart | Out-Null
        $script:RestartRequired = $true
    }
    if ($vmpFeature.State -ne "Enabled") {
        Write-Info "Enabling Windows feature VirtualMachinePlatform..."
        Enable-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform" -All -NoRestart | Out-Null
        $script:RestartRequired = $true
    }
    if (Test-CommandAvailable "wsl") {
        [void](Invoke-NativeQuiet "wsl" @("--set-default-version", "2"))
    }
    Ensure-Wsl2Kernel
    Write-Ok "WSL2 features ensured"

    if (Test-RuntimeInstallNeeded) {
        if ($Runtime -eq "rancher") {
            Install-RancherDesktopDirect
        } else {
            Install-DockerViaBestMethod -HasWinget $hasWinget
        }
        $script:RestartRequired = $true
    }
    Write-Ok "Container runtime present"

    # docker-users membership only applies to Docker Desktop; Rancher Desktop
    # (WSL2 distro per user) has no equivalent group requirement.
    if (Test-DockerDesktopInstalled) {
        try {
            $group = Get-LocalGroup -Name "docker-users" -ErrorAction SilentlyContinue
            if ($group) {
                $currentUser = "$env:USERDOMAIN\$env:USERNAME"
                $members = @(Get-LocalGroupMember -Group "docker-users" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
                if ($members -notcontains $currentUser) {
                    # Only a SUCCESSFUL add warrants a re-logon; enumeration can fail
                    # spuriously (unresolvable SIDs), and re-adding an existing member
                    # errors — neither may trigger the reboot gate on every run.
                    try {
                        Add-LocalGroupMember -Group "docker-users" -Member $currentUser -ErrorAction Stop
                        Write-Ok "Added $currentUser to docker-users (re-logon required)"
                        $script:RestartRequired = $true
                    } catch {
                        if ($_.Exception.Message -notmatch "already a member") {
                            Write-Warn "Could not add $currentUser to docker-users: $($_.Exception.Message)"
                        }
                    }
                }
            }
        } catch {
            Write-Warn "Could not verify docker-users group membership: $($_.Exception.Message)"
        }
    }

    if (-not $SkipDefenderExclusion -and $RepoPathForExclusion) {
        try {
            if (-not (Test-Path $RepoPathForExclusion)) {
                New-Item -Path $RepoPathForExclusion -ItemType Directory -Force | Out-Null
            }
            $prefs = Get-MpPreference
            if ($prefs.ExclusionPath -notcontains $RepoPathForExclusion) {
                Add-MpPreference -ExclusionPath $RepoPathForExclusion
                Write-Ok "Defender exclusion added for $RepoPathForExclusion"
            }
        } catch {
            Write-Warn "Could not add Defender exclusion: $($_.Exception.Message)"
        }
    }

    if ($script:RestartRequired) { exit 10 }
    exit 0
}

function Invoke-InstallPhaseIfNeeded {
    Write-StepHeader "Prerequisites (Git, WSL2, container runtime)" "checks are instant; installing anything missing takes 5-15 minutes"

    # Detect what's missing first — this drives both the no-admin guidance and
    # the elevation decision.
    $needsGit = -not (Test-GitInstalled)
    $needsWsl = -not (Test-WslFeaturesEnabled)
    $hasDockerDesktop = Test-DockerDesktopInstalled
    $hasRancher = Test-RancherDesktopInstalled
    $needsRuntime = Test-RuntimeInstallNeeded
    $needsExclusion = $false
    if (-not $SkipDefenderExclusion) {
        $exclusionTarget = if ($script:RepoRoot) { $script:RepoRoot } else { Join-Path $CloneRoot $RepoName }
        try {
            $prefs = Get-MpPreference -ErrorAction Stop
            $needsExclusion = ($prefs.ExclusionPath -notcontains $exclusionTarget)
        } catch {
            # Defender cmdlets unavailable (Server Core, LTSC, third-party AV):
            # skip rather than triggering the elevated phase on every run.
            Write-Warn "Cannot query Microsoft Defender preferences - skipping the exclusion step."
            $needsExclusion = $false
        }
    }

    # Always show what was found, so corporate users know exactly where they
    # stand even when nothing needs installing.
    $runtimeLabel = if ($hasDockerDesktop -and $hasRancher) { "Docker Desktop + Rancher Desktop" }
        elseif ($hasDockerDesktop) { "Docker Desktop" }
        elseif ($hasRancher) { "Rancher Desktop" }
        elseif (-not $needsRuntime) { "docker CLI (IT-managed)" }
        else { "MISSING" }
    Write-Host "  Git:               " -NoNewline
    if ($needsGit) { Write-Host "MISSING (will be installed)" -ForegroundColor Yellow } else { Write-Host "present" -ForegroundColor Green }
    Write-Host "  WSL2:              " -NoNewline
    if ($needsWsl) { Write-Host "MISSING (will be installed)" -ForegroundColor Yellow } else { Write-Host "present" -ForegroundColor Green }
    Write-Host "  Container runtime: " -NoNewline
    if ($runtimeLabel -eq "MISSING") { Write-Host "MISSING (will be installed)" -ForegroundColor Yellow } else { Write-Host $runtimeLabel -ForegroundColor Green }
    if ($Runtime -eq "auto") {
        Write-Host "  (auto-detecting the runtime - double-click start-windows-rancher.bat or start-windows-docker.bat to force one)" -ForegroundColor DarkGray
    }

    if (-not ($needsGit -or $needsWsl -or $needsRuntime -or $needsExclusion)) {
        Write-Ok "All prerequisites already installed - no administrator rights needed"
        return
    }

    # Never ask for admin when the only gap is the Defender exclusion - it is
    # a performance nicety, and demanding UAC for it would block no-admin
    # accounts on otherwise fully provisioned machines.
    if ($needsExclusion -and -not ($needsGit -or $needsWsl -or $needsRuntime)) {
        Write-Warn "Skipping the Defender exclusion (needs admin) - the stack still works, just with more antivirus file-scan overhead. Optional, from an elevated PowerShell: Add-MpPreference -ExclusionPath '$(if ($script:RepoRoot) { $script:RepoRoot } else { Join-Path $CloneRoot $RepoName })'"
        return
    }

    # Minimal-admin path: when WSL2 is already in place (enterprise images
    # often pre-enable it) and Rancher is the chosen runtime, its MSI installs
    # per-user - zero elevation. Git alone never forces admin either (the
    # clone step falls back to a ZIP download), and the Defender exclusion is
    # a perf nicety.
    if ($needsRuntime -and -not $needsWsl -and $Runtime -eq "rancher") {
        if ($DryRun) { Write-Info "Would install Rancher Desktop per-user (no admin)."; return }
        Install-RancherDesktopDirect -PerUser
        if ($needsGit) { Write-Warn "Git is not installed - the repository will be downloaded as a ZIP instead of cloned (no admin needed)." }
        if ($needsExclusion) { Write-Warn "Skipping the Defender exclusion (needs admin) - the stack still works, just with more antivirus file-scan overhead." }
        Write-Ok "Prerequisites ready without administrator rights"
        return
    }

    $runtimeToInstall = if ($Runtime -eq "rancher") { "Rancher Desktop" } else { "Docker Desktop" }
    $missingItems = @()
    if ($needsGit) { $missingItems += "Git" }
    if ($needsWsl) { $missingItems += "WSL2 features" }
    if ($needsRuntime) { $missingItems += $runtimeToInstall }
    if ($needsExclusion) { $missingItems += "Defender exclusion" }

    # Something is missing, so this is effectively a clean machine that needs the
    # full (admin) install. -NoAdmin / -SkipInstall force the no-admin path for
    # accounts that cannot elevate (IT-provisioned runtime + WSL2); any cancelled
    # UAC prompt below degrades to the same guidance.
    $skipAdmin = $NoAdmin -or $SkipInstall
    if ($skipAdmin) {
        # Only the container runtime + WSL2 are truly required; the Defender
        # exclusion is a perf nicety, and a missing Git falls back to a repo
        # ZIP download in the clone step.
        $blocking = @()
        if ($needsRuntime) { $blocking += "a container runtime (Docker Desktop or Rancher Desktop)" }
        if ($needsWsl) { $blocking += "WSL2 (Windows feature + kernel)" }
        if ($blocking.Count -gt 0) {
            Write-Fail ("Running without admin, but these are required and not present: {0}. Ask IT (or an admin) to enable WSL2 (the pinned MSI: https://github.com/microsoft/WSL/releases/tag/$($script:WslPinnedVersion)) and/or install Docker Desktop (WSL2 backend; add your account to 'docker-users') OR Rancher Desktop with the dockerd (moby) engine, then re-run the launcher with -NoAdmin. With WSL2 in place, start-windows-rancher.bat installs Rancher per-user - no admin at all. Nothing was changed." -f ($blocking -join ", "))
        }
        if ($needsGit) { Write-Warn "Git is not installed - the repository will be downloaded as a ZIP instead of cloned (no admin needed)." }
        if ($needsExclusion) { Write-Warn "Skipping the Defender exclusion (needs admin) - the stack still works, just with more antivirus file-scan overhead." }
        Write-Ok "Skipping admin install - container runtime + WSL2 are present; continuing without elevation"
        return
    }

    if ($DryRun) {
        Write-Info ("Would install (elevated): {0}" -f ($missingItems -join ", "))
        return
    }

    Write-Info ("Requesting administrator rights to install: {0}. Approve the UAC prompt (or Cancel if you don't have admin - setup will show the no-admin path)." -f ($missingItems -join ", "))

    $exclusionArg = if ($script:RepoRoot) { $script:RepoRoot } else { Join-Path $CloneRoot $RepoName }
    $childArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
        "-Elevated",
        "-Runtime", $Runtime,
        "-RepoPathForExclusion", "`"$exclusionArg`""
    )
    if ($SkipDefenderExclusion) { $childArgs += "-SkipDefenderExclusion" }
    if ($NonInteractive) { $childArgs += "-NonInteractive" }

    $child = $null
    try {
        $child = Start-Process -FilePath "powershell" -ArgumentList $childArgs -Verb RunAs -Wait -PassThru
    } catch {
        Write-Fail "Administrator elevation was cancelled or is unavailable on this account. If you don't have admin, ask IT to enable WSL2 (pinned MSI: https://github.com/microsoft/WSL/releases/tag/$($script:WslPinnedVersion)) - with WSL2 in place, start-windows-rancher.bat installs Rancher Desktop per-user without admin. Alternatively IT can install Docker Desktop (WSL2 backend + 'docker-users' membership) or Rancher Desktop (dockerd/moby engine); then re-run the launcher with -NoAdmin. Otherwise re-run and approve the UAC prompt."
    }
    switch ($child.ExitCode) {
        0 { Write-Ok "Prerequisites installed" }
        10 {
            $script:RestartRequired = $true
            Write-Ok "Prerequisites installed (restart required)"
        }
        default { Write-Fail "Elevated install phase failed (exit $($child.ExitCode)). See $script:ResolvedLogPath." }
    }

    # The elevated child updated the machine PATH; this process still holds
    # the stale copy. Re-probing prepends the Program Files git path when
    # needed so a same-run `git clone` works without a new shell.
    [void](Test-GitInstalled)
}

# ---------------------------------------------------------------------------
# Reboot gate
# ---------------------------------------------------------------------------

function Clear-RunOnceEntry {
    try {
        Remove-ItemProperty -Path $script:RunOnceKey -Name $script:RunOnceName -ErrorAction SilentlyContinue
    } catch {}
}

function Invoke-RebootGate {
    Write-StepHeader "Reboot check" "instant; if a restart is needed, setup resumes automatically after login"
    if (-not $script:RestartRequired) {
        Write-Ok "No reboot required"
        return
    }

    if ($LauncherPath -and (Test-Path $LauncherPath)) {
        $resumeCommand = "cmd /c `"`"$LauncherPath`"`""
        try {
            New-Item -Path $script:RunOnceKey -Force -ErrorAction SilentlyContinue | Out-Null
            Set-ItemProperty -Path $script:RunOnceKey -Name $script:RunOnceName -Value $resumeCommand
            Write-Ok "Setup will resume automatically after you log back in"
        } catch {
            Write-Warn "Could not register auto-resume: $($_.Exception.Message)"
        }
    }

    Write-Host ""
    Write-Host "Windows must restart to finish enabling WSL2 / Docker Desktop." -ForegroundColor Yellow
    Write-Host "After logging back in, setup resumes automatically - or double-click start-windows.bat again." -ForegroundColor Yellow

    if ($NonInteractive) { exit 10 }

    $answer = Read-Host "Restart now? [Y/n]"
    if ($answer -eq "" -or $answer -match "^[Yy]") {
        Restart-Computer -Force
    }
    exit 10
}

# ---------------------------------------------------------------------------
# WSL2 memory sizing
# ---------------------------------------------------------------------------

function Ensure-WslMemoryConfig {
    # WSL2's defaults are wrong for this stack on 16 GB machines: Windows 11
    # caps the VM at min(50% of RAM, 8 GB) while the stack needs ~8-10 GB
    # inside it (the OOM killer then surfaces as "app container
    # crash-looping"), and Windows 10 lets the VM take up to 80% of RAM and
    # starve the host. One explicit cap fixes both directions; Docker Desktop
    # and Rancher Desktop both run on WSL2, so it covers either runtime.
    # Fill-missing-only: an existing memory= line is never touched.
    Write-StepHeader "WSL2 memory sizing (.wslconfig)" "instant"
    if ($DryRun) { Write-Info "Would cap the WSL2 VM via %USERPROFILE%\.wslconfig on machines under 20 GB RAM."; return }
    if (-not $script:TotalRamGb -or $script:TotalRamGb -le 0) {
        Write-Ok "Total RAM unknown - leaving WSL2 defaults in place"
        return
    }
    if ($script:TotalRamGb -ge 20) {
        Write-Ok ("{0} GB RAM - WSL2 defaults are fine, leaving them in place" -f $script:TotalRamGb)
        return
    }
    $configPath = Join-Path $env:USERPROFILE ".wslconfig"
    $existing = ""
    if (Test-Path $configPath) { $existing = [System.IO.File]::ReadAllText($configPath) }
    if ($existing -match "(?im)^[ \t]*memory[ \t]*=") {
        Write-Ok ".wslconfig already sets a WSL2 memory limit - leaving it untouched"
        return
    }
    $memoryGb = [int][math]::Max(8, [math]::Floor($script:TotalRamGb) - 6)
    $settings = "memory=${memoryGb}GB`r`nswap=8GB`r`nautoMemoryReclaim=gradual"
    if ($existing -match "(?im)^[ \t]*\[wsl2\][ \t]*\r?$") {
        # Keys must live under the EXISTING [wsl2] header - a duplicate
        # section is undefined behavior for the .wslconfig parser. The
        # lookahead keeps the header's own CRLF in place (in .NET multiline
        # mode a bare $ never matches before the \r of \r\n).
        $sectionRegex = New-Object System.Text.RegularExpressions.Regex("(?im)^[ \t]*\[wsl2\][ \t]*(?=\r?$)")
        $newContent = $sectionRegex.Replace($existing, "[wsl2]`r`n$settings", 1)
    } elseif ([string]::IsNullOrWhiteSpace($existing)) {
        $newContent = "[wsl2]`r`n$settings`r`n"
    } else {
        $separator = if ($existing.EndsWith("`n")) { "" } else { "`r`n" }
        $newContent = "{0}{1}[wsl2]`r`n{2}`r`n" -f $existing, $separator, $settings
    }
    [System.IO.File]::WriteAllText($configPath, $newContent)
    Write-Ok ("Capped the WSL2 VM in {0}: memory={1}GB, swap=8GB, autoMemoryReclaim=gradual (delete those lines to revert)" -f $configPath, $memoryGb)
    $engineRunning = Test-DockerEngineReady
    if ((Test-CommandAvailable "wsl") -and -not $engineRunning) {
        [void](Invoke-NativeQuiet "wsl" @("--shutdown"))
        Write-Info "Applied via 'wsl --shutdown' (the container engine was not running yet)."
    } elseif ($engineRunning) {
        Write-Warn "The container engine is already running - the new WSL2 memory cap takes effect after you quit Docker Desktop / Rancher Desktop and run 'wsl --shutdown' (or reboot)."
    }
}

# ---------------------------------------------------------------------------
# Docker engine
# ---------------------------------------------------------------------------

function Start-DockerEngine {
    Write-StepHeader "Container engine (Docker / Rancher)" "instant when already running; 30-90s to start; up to 5 min on the very first launch"
    if (Test-DockerEngineReady) {
        Write-Ok "Container engine is running"
        return
    }
    if ($DryRun) { Write-Info "Would start Docker Desktop / Rancher Desktop and wait for the engine."; return }

    $dockerExe = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
    $rancherExe = Get-RancherDesktopExe
    $startingWhat = $null

    # Dual-install machines: both runtimes register a docker CLI context, so
    # probing the wrong one makes a running engine look dead. Prefer whichever
    # is ALREADY running; else honor -Runtime; else default to Docker Desktop.
    if ((Test-Path $dockerExe) -and $rancherExe) {
        $dockerRunning = $null -ne (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)
        $rancherRunning = $null -ne (Get-Process -Name "Rancher Desktop" -ErrorAction SilentlyContinue)
        $preferRancher = if ($Runtime -eq "rancher") { $true }
            elseif ($Runtime -eq "docker") { $false }
            elseif ($rancherRunning -and -not $dockerRunning) { $true }
            else { $false }
        Write-Info ("Both Docker Desktop and Rancher Desktop are installed - using {0} (override with -Runtime docker|rancher)." -f $(if ($preferRancher) { "Rancher Desktop" } else { "Docker Desktop" }))
        if ($preferRancher) { $dockerExe = $null } else { $rancherExe = $null }
    }

    if ($dockerExe -and (Test-Path $dockerExe)) {
        if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
            Write-Info "Starting Docker Desktop..."
            Start-Process -FilePath $dockerExe | Out-Null
        }
        $startingWhat = "Docker Desktop"
    } elseif ($rancherExe) {
        if (-not (Get-Process -Name "Rancher Desktop" -ErrorAction SilentlyContinue)) {
            # Prefer rdctl: it can start Rancher headless with the dockerd (moby)
            # engine (required for `docker compose`) and Kubernetes off (lighter).
            $rdctlCandidates = @(
                (Join-Path $env:USERPROFILE ".rd\bin\rdctl.exe"),
                (Join-Path (Split-Path -Parent $rancherExe) "resources\resources\win32\bin\rdctl.exe")
            )
            $rdctl = $rdctlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
            if ($rdctl) {
                Write-Info "Starting Rancher Desktop (dockerd/moby engine, Kubernetes off)..."
                [void](Invoke-NativeQuiet $rdctl @("start", "--container-engine.name=moby", "--kubernetes.enabled=false", "--application.start-in-background=true"))
            } else {
                Write-Info "Starting Rancher Desktop... (first run: pick the 'dockerd (moby)' engine when asked - required for docker compose)"
                Start-Process -FilePath $rancherExe | Out-Null
            }
        }
        $startingWhat = "Rancher Desktop"
    }

    if (-not $startingWhat) {
        Write-Fail "No container runtime found to start (Docker Desktop or Rancher Desktop). Install one (or ask IT to), then re-run the launcher - start-windows-rancher.bat or start-windows-docker.bat picks the runtime explicitly."
    }

    # Keep the docker CLI context pointed at the runtime we chose. Which
    # context name answers depends on the runtime and version: Docker Desktop
    # registers desktop-linux, while Rancher Desktop typically serves the
    # DEFAULT context's named pipe WITHOUT registering a context of its own -
    # assuming a single name here is exactly how a fully booted Rancher engine
    # used to look dead forever. Contexts may also only appear after the
    # runtime's first start, so probe the candidates on every tick.
    $contextCandidates = if ($startingWhat -eq "Rancher Desktop") { @("rancher-desktop", "default") } else { @("desktop-linux", "default") }

    $startedAt = Get-Date
    $deadline = $startedAt.AddSeconds(300)
    while ((Get-Date) -lt $deadline) {
        if ((Select-WorkingDockerContext -Candidates $contextCandidates) -or (Test-DockerEngineReady)) {
            Write-Host ""
            Write-Ok "Container engine is ready ($startingWhat)"
            return
        }
        Write-WaitTick -StartedAt $startedAt -Message "waiting for the $startingWhat engine (VM boot; first-ever launch is the slowest)"
        Start-Sleep -Seconds 5
    }

    Write-Host ""
    Write-Fail "The container engine did not become ready within 5 minutes. Open $startingWhat from the Start menu and finish any first-run dialogs (Docker sign-in can be skipped; in Rancher pick the 'dockerd (moby)' engine). If it reports 'WSL 2 installation is incomplete', install WSL from https://github.com/microsoft/WSL/releases/tag/$($script:WslPinnedVersion) (or run 'wsl --update' in an elevated prompt), then re-run the launcher. Log: $script:ResolvedLogPath"
}

function Get-StandaloneComposeExe {
    $command = Get-Command "docker-compose" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $rdCompose = Join-Path $env:USERPROFILE ".rd\bin\docker-compose.exe"
    if (Test-Path $rdCompose) { return $rdCompose }
    return $null
}

function Resolve-ComposeExe {
    # Returns $null when the `docker compose` CLI plugin works, else the full
    # path of a standalone docker-compose binary to call directly. Cached so
    # polling loops don't re-probe on every compose call.
    if ($script:ComposeProbed) { return $script:ComposeExe }
    $script:ComposeProbed = $true
    Add-RancherBinToPath
    if ((Invoke-NativeQuiet "docker" @("compose", "version")) -eq 0) {
        $script:ComposeExe = $null
    } else {
        $script:ComposeExe = Get-StandaloneComposeExe
    }
    return $script:ComposeExe
}

function Ensure-DockerCompose {
    # `docker compose` is a CLI plugin the docker CLI resolves from
    # ~\.docker\cli-plugins - NOT from PATH. Rancher Desktop ships the plugin
    # binary as ~\.rd\bin\docker-compose.exe but does not reliably wire it
    # into the plugin directory, so `docker compose -f ...` fails with
    # "'compose' is not a docker command" even though compose is installed.
    # Wire it up here; if that is not possible, fall back to calling the
    # standalone binary directly for every compose operation.
    if ($DryRun) { return }
    if ((Invoke-NativeQuiet "docker" @("compose", "version")) -eq 0) {
        $script:ComposeProbed = $true
        $script:ComposeExe = $null
        return
    }
    $standalone = Get-StandaloneComposeExe
    if (-not $standalone) {
        Write-Fail "Neither 'docker compose' nor 'docker-compose' works. If you use Rancher Desktop: open it, set Preferences > Container Engine to 'dockerd (moby)', apply and wait for the restart, then re-run start-windows.bat. Log: $script:ResolvedLogPath"
    }
    $pluginDir = Join-Path $env:USERPROFILE ".docker\cli-plugins"
    try {
        New-Item -Path $pluginDir -ItemType Directory -Force | Out-Null
        Copy-Item -Path $standalone -Destination (Join-Path $pluginDir "docker-compose.exe") -Force
    } catch {
        Write-Warn "Could not copy the compose plugin into ${pluginDir}: $($_.Exception.Message)"
    }
    $script:ComposeProbed = $true
    if ((Invoke-NativeQuiet "docker" @("compose", "version")) -eq 0) {
        $script:ComposeExe = $null
        Write-Ok "docker compose plugin wired up (from $standalone)"
        return
    }
    $script:ComposeExe = $standalone
    Write-Info "'docker compose' is unavailable in this docker CLI - using the standalone compose binary at $standalone instead."
}

# ---------------------------------------------------------------------------
# Corporate TLS interception (proxy re-signs HTTPS with a private root CA)
# ---------------------------------------------------------------------------

function Sync-CorporateCerts {
    # Users (or Repair-TlsInterception) drop the proxy root CA into
    # docker\certs\ once; the opencode image builds from its own context
    # (docker\opencode\), so mirror the PEM files into it before compose
    # builds anything.
    if (-not $script:RepoRoot) { return }
    $sourceDir = Join-Path $script:RepoRoot "docker\certs"
    $targetDir = Join-Path $script:RepoRoot "docker\opencode\certs"
    # Both directories are COPY'd by the Dockerfiles - recreate them when a
    # partial checkout / ZIP download lost them, so builds never fail on that.
    New-Item -Path $sourceDir -ItemType Directory -Force | Out-Null
    New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
    $certFiles = @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq ".crt" -or $_.Extension -eq ".pem" })
    if ($certFiles.Count -eq 0) { return }
    foreach ($certFile in $certFiles) {
        Copy-Item -Path $certFile.FullName -Destination (Join-Path $targetDir $certFile.Name) -Force
    }
}

function Test-TlsInterceptionSignature {
    param([string]$Text)
    if (-not $Text) { return $false }
    return ($Text -match "certificate not trusted|certificate verify failed|certificate verification failed|unable to get local issuer certificate|self.signed certificate|SSL certificate problem|tls: failed to verify|x509: certificate signed by unknown authority")
}

function Test-NetworkFailureSignature {
    # Matches build downloads failing in bulk without a clear TLS wording:
    # apk aborting on unfetchable package indexes, DNS errors, timeouts, or the
    # proxy's blunt "Permission denied". These need the container-egress triage
    # to tell WHY (DNS vs TLS interception vs proxy category-block).
    param([string]$Text)
    if (-not $Text) { return $false }
    return ($Text -match "apk add[^`r`n]*did not complete successfully|unable to select packages|bad address|temporary error \(try again later\)|Could not resolve host|network is unreachable|i/o timeout|TLS handshake timeout|dl-cdn\.alpinelinux\.org[^`r`n]*Permission denied")
}

function ConvertTo-PemCertificate {
    param([Parameter(Mandatory = $true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    $base64 = [Convert]::ToBase64String($Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    $wrapped = ($base64 -replace "(.{64})", "`$1`n").TrimEnd("`n")
    return "-----BEGIN CERTIFICATE-----`n$wrapped`n-----END CERTIFICATE-----`n"
}

function Export-ObservedTlsRootCa {
    # Opens a TLS connection from Windows (which trusts the corporate root)
    # and returns the ROOT certificate of the presented chain as a PEM string.
    # On an intercepted network that root is the proxy's CA - exactly what the
    # container builds need to trust. Returns $null when the chain cannot be
    # captured (e.g. the proxy requires CONNECT and blocks raw sockets).
    param([Parameter(Mandatory = $true)][string]$ProbeHost)
    $tcpClient = $null
    $sslStream = $null
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient($ProbeHost, 443)
        $acceptAnyCertificate = [System.Net.Security.RemoteCertificateValidationCallback] { param($callbackSender, $certificate, $certificateChain, $sslPolicyErrors) $true }
        $sslStream = New-Object System.Net.Security.SslStream($tcpClient.GetStream(), $false, $acceptAnyCertificate)
        $sslStream.AuthenticateAsClient($ProbeHost)
        $leaf = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($sslStream.RemoteCertificate)
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        [void]$chain.Build($leaf)
        if ($chain.ChainElements.Count -lt 1) { return $null }
        $root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate
        return (ConvertTo-PemCertificate -Certificate $root)
    } catch {
        return $null
    } finally {
        if ($sslStream) { $sslStream.Dispose() }
        if ($tcpClient) { $tcpClient.Dispose() }
    }
}

function Export-KnownInterceptionRootsFromStore {
    # CONNECT-only proxies block the raw-socket chain capture below, but IT
    # always installs the interception root into the Windows certificate
    # store. Export every root from a known TLS-inspection vendor so the
    # image builds can trust whichever one re-signs their traffic.
    param([Parameter(Mandatory = $true)][string]$TargetDir)
    $vendorPattern = "Zscaler|Netskope|Blue ?Coat|Palo Alto|Forcepoint|Fortinet|FortiGate|Cisco Umbrella|Skyhigh|McAfee|Sophos|WatchGuard|iboss|Menlo Security"
    $roots = @()
    foreach ($storePath in @("Cert:\LocalMachine\Root", "Cert:\CurrentUser\Root")) {
        $roots += @(Get-ChildItem -Path $storePath -ErrorAction SilentlyContinue | Where-Object { $_.Subject -match $vendorPattern })
    }
    $exported = 0
    foreach ($cert in ($roots | Sort-Object -Property Thumbprint -Unique)) {
        $fileName = "interception-root-{0}.crt" -f $cert.Thumbprint.Substring(0, 8).ToLower()
        [System.IO.File]::WriteAllText((Join-Path $TargetDir $fileName), (ConvertTo-PemCertificate -Certificate $cert))
        Write-Ok ("Exported interception root from the Windows store: {0} -> docker\certs\{1}" -f $cert.Subject, $fileName)
        $exported++
    }
    return ($exported -gt 0)
}

function Repair-TlsInterception {
    # A TLS-intercepting proxy (Zscaler, Netskope, ...) breaks every HTTPS
    # download inside docker builds: the corporate root CA is trusted by
    # Windows but not by the build containers. Capture the root Windows sees,
    # hand it to the builds via docker\certs\ (both Dockerfiles trust that
    # directory), and let the caller retry once. Returns $true when a retry
    # makes sense.
    if ($script:TlsRepairAttempted) { return $false }
    $script:TlsRepairAttempted = $true
    Write-Info "The failure looks like a TLS-intercepting proxy (corporate network). Capturing its root certificate so the image builds can trust it..."
    $certsDir = Join-Path $script:RepoRoot "docker\certs"
    New-Item -Path $certsDir -ItemType Directory -Force | Out-Null
    # Probe the host the failing download talks to first - SNI-based proxy
    # rules can intercept one host and pass another through untouched.
    $pem = $null
    foreach ($probeHost in @("dl-cdn.alpinelinux.org", "registry-1.docker.io", "github.com")) {
        $pem = Export-ObservedTlsRootCa -ProbeHost $probeHost
        if ($pem) { break }
    }
    if ($pem) {
        [System.IO.File]::WriteAllText((Join-Path $certsDir "corporate-proxy-root.crt"), $pem)
        Write-Ok "Proxy root certificate exported to docker\certs\corporate-proxy-root.crt"
    } elseif (-not (Export-KnownInterceptionRootsFromStore -TargetDir $certsDir)) {
        Write-Warn "Could not capture the proxy's root certificate automatically. Export your company's root CA as a Base-64 X.509 (PEM) file into docker\certs\ (see docker\certs\README.md), then re-run start-windows.bat -Rebuild."
        return $false
    }
    Sync-CorporateCerts
    return $true
}

function Invoke-BuildNetworkTriage {
    # A build download step failed without a clear TLS wording. Probe the
    # network FROM INSIDE a container - the exact path the image build uses -
    # and classify the failure: DNS dead, TLS interception, proxy block page,
    # or actually fine. Returns $true when a TLS repair was applied and a
    # compose retry makes sense; every other outcome prints targeted guidance.
    $probeImage = "node:24-alpine"
    if ((Invoke-NativeQuiet "docker" @("image", "inspect", $probeImage)) -ne 0) {
        Write-Warn "The build is failing before its base image ($probeImage) is even available locally - the Docker engine itself cannot pull images on this network. If pulls fail with an x509/certificate error, the engine needs your corporate root CA; run starters\docker\windows\check-windows.bat for the full egress picture and docker\certs\README.md for the cert steps."
        return $false
    }
    Write-Info "Diagnosing network access from inside a container (the same path image builds use)..."
    # Single-quoted on purpose: everything in here is busybox sh, not PowerShell.
    $probeScript = 'if ! nslookup dl-cdn.alpinelinux.org >/dev/null 2>&1; then echo OM_TRIAGE=DNS_FAIL; exit 0; fi; ' +
        'out=$(wget -T 20 -O /tmp/apkindex https://dl-cdn.alpinelinux.org/alpine/latest-stable/main/x86_64/APKINDEX.tar.gz 2>&1); ' +
        'if [ $? -ne 0 ]; then echo "$out"; if echo "$out" | grep -qiE "certificate|trust|verif"; then echo OM_TRIAGE=TLS_FAIL; else echo OM_TRIAGE=FETCH_FAIL; fi; exit 0; fi; ' +
        'magic=$(head -c 2 /tmp/apkindex | od -An -tx1 | tr -d " \n"); ' +
        'if [ "$magic" = "1f8b" ]; then echo OM_TRIAGE=OK; else echo OM_TRIAGE=BLOCK_PAGE; fi'
    $probeOutput = Invoke-NativeCapture "docker" @("run", "--rm", $probeImage, "sh", "-c", $probeScript)
    if ($probeOutput -match "OM_TRIAGE=DNS_FAIL") {
        Write-Warn "Containers cannot resolve DNS (dl-cdn.alpinelinux.org does not resolve inside the VM). This is the classic corporate-VPN + WSL2 DNS breakage: quit the container runtime (Rancher: 'rdctl shutdown'; Docker Desktop: Quit), run 'wsl --shutdown', reconnect the VPN, then re-run the launcher. If it persists, ask IT about VPN DNS for WSL2."
        return $false
    }
    if ($probeOutput -match "OM_TRIAGE=TLS_FAIL") {
        Write-Info "Containers reach the network but do not trust its TLS - a TLS-intercepting proxy."
        return (Repair-TlsInterception)
    }
    if ($probeOutput -match "OM_TRIAGE=BLOCK_PAGE") {
        Write-Warn "Your proxy answers dl-cdn.alpinelinux.org with a block page, so Alpine packages in image builds cannot download. Ask IT to allow dl-cdn.alpinelinux.org (plus registry-1.docker.io, registry.yarnpkg.com, opencode.ai, github.com), or point the build at an internal Alpine mirror: set ALPINE_MIRROR=<mirror base URL> in the repo-root .env and re-run with -Rebuild."
        return $false
    }
    if ($probeOutput -match "OM_TRIAGE=OK") {
        Write-Info "Container network to dl-cdn.alpinelinux.org works - the build failure is not basic egress. The failing step's own output above has the real error."
        return $false
    }
    Write-Warn ("Container network probe was inconclusive. Probe output: {0}" -f (($probeOutput -replace "\s+", " ").Trim()))
    return $false
}

# ---------------------------------------------------------------------------
# Standalone clone
# ---------------------------------------------------------------------------

function Invoke-StandaloneClone {
    Write-StepHeader "Get the repository" "1-3 minutes on a typical connection"
    $targetPath = Join-Path $CloneRoot $RepoName

    if (Test-Path (Join-Path $targetPath $script:ComposeFile)) {
        Write-Ok "Existing clone found at $targetPath"
    } else {
        if ((Test-Path $targetPath) -and (Get-ChildItem $targetPath -ErrorAction SilentlyContinue | Select-Object -First 1)) {
            Write-Fail "$targetPath exists but is not an Open Mercato clone. Move it aside or pass -CloneRoot/-RepoName."
        }
        if ($DryRun) {
            Write-Info "Would clone $RepoUrl ($Branch) into $targetPath."
            Write-Section "Dry run complete - no changes were made"
            Complete-Logging
            exit 0
        }
        if (-not $NonInteractive) {
            $answer = Read-Host "Download Open Mercato into '$targetPath'? [Y/n]"
            if ($answer -match "^[Nn]") { Write-Fail "Download declined. Re-run with -CloneRoot/-RepoName to choose another location." }
        }
        if (Test-CommandAvailable "git") {
            Write-Info "Cloning $RepoUrl (branch $Branch)..."
            $cloneExit = Invoke-NativeVisible "git" @("clone", "--branch", $Branch, $RepoUrl, $targetPath)
            if ($cloneExit -ne 0) {
                Write-Fail "git clone failed (exit $cloneExit). Check network/proxy access to github.com."
            }
            Write-Ok "Cloned into $targetPath"
        } else {
            # No Git (e.g. -NoAdmin on a machine where it can't be installed):
            # fall back to the branch ZIP, which needs no Git at all.
            Write-Info "Git is not available - downloading the repository as a ZIP instead..."
            $zipBase = $RepoUrl -replace '\.git$', ''
            $zipUrl = "$zipBase/archive/refs/heads/$Branch.zip"
            $zipFile = Join-Path $env:TEMP "open-mercato-$Branch.zip"
            if (-not (Get-RemoteFile -Url $zipUrl -OutFile $zipFile -DisplayName "repository ZIP" -FileType zip -MinBytes 1MB)) {
                Write-Fail "The repository ZIP could not be downloaded. Download it manually from $zipUrl, extract it, and double-click starters\docker\windows\start-windows.bat inside it."
            }
            $extractDir = Join-Path $env:TEMP ("om-extract-" + [System.IO.Path]::GetRandomFileName())
            Expand-Archive -Path $zipFile -DestinationPath $extractDir -Force
            $topDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
            if (-not $topDir) { Write-Fail "The repository ZIP did not contain the expected folder." }
            New-Item -Path (Split-Path -Parent $targetPath) -ItemType Directory -Force | Out-Null
            Move-Item -Path $topDir.FullName -Destination $targetPath
            Remove-Item $zipFile, $extractDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "Repository downloaded into $targetPath (no git history - re-download to update)"
        }
    }

    # Continue on the cloned tree's own launcher so future logic always runs
    # from the repo copy.
    $inRepoScript = Join-Path $targetPath "starters\docker\windows\start-dev.ps1"
    $inRepoLauncher = Join-Path $targetPath "starters\docker\windows\start-windows.bat"
    if (-not (Test-Path $inRepoScript)) {
        Write-Fail "Cloned repo does not contain starters\docker\windows\start-dev.ps1 (branch too old?)."
    }
    Write-Info "Re-entering setup from the cloned repository..."
    $forward = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$inRepoScript`"", "-LauncherPath", "`"$inRepoLauncher`"")
    if ($NonInteractive) { $forward += "-NonInteractive" }
    if ($DryRun) { $forward += "-DryRun" }
    if ($SkipInstall) { $forward += "-SkipInstall" }
    if ($SkipLlmPrompt) { $forward += "-SkipLlmPrompt" }
    if ($Rebuild) { $forward += "-Rebuild" }
    if ($NoAdmin) { $forward += "-NoAdmin" }
    if ($SkipResourceCheck) { $forward += "-SkipResourceCheck" }
    if ($Runtime -ne "auto") { $forward += @("-Runtime", $Runtime) }
    if ($SkipDefenderExclusion) { $forward += "-SkipDefenderExclusion" }
    if ($Yes) { $forward += "-Yes" }
    if ($TimeoutMinutes -ne 30) { $forward += @("-TimeoutMinutes", $TimeoutMinutes) }
    if ($LogPath) { $forward += @("-LogPath", "`"$LogPath`"") }
    $child = Start-Process -FilePath "powershell" -ArgumentList $forward -Wait -PassThru -NoNewWindow
    exit $child.ExitCode
}

# ---------------------------------------------------------------------------
# .env handling (fill-missing-only; never rewrites existing non-empty values;
# writes UTF-8 without BOM and LF line endings so docker compose and the
# in-container dotenv loaders parse the file identically on every platform)
# ---------------------------------------------------------------------------

function Get-EnvValue {
    param([string]$FilePath, [string]$Key)
    if (-not (Test-Path $FilePath)) { return $null }
    $line = Select-String -Path $FilePath -Pattern ("^{0}=" -f [regex]::Escape($Key)) | Select-Object -First 1
    if ($line) { return ($line.Line.Substring($Key.Length + 1)) }
    return $null
}

function Write-EnvFileText {
    param([string]$FilePath, [string]$Content)
    # .NET Framework StreamWriter default = UTF-8 WITHOUT BOM; PS 5.1's own
    # Set-Content -Encoding UTF8 would prepend a BOM that some compose dotenv
    # parsers choke on.
    [System.IO.File]::WriteAllText($FilePath, $Content)
}

function Add-EnvValue {
    param([string]$FilePath, [string]$Key, [string]$Value, [switch]$Secret, [switch]$ReplaceEmpty)
    $existing = Get-EnvValue -FilePath $FilePath -Key $Key
    if ($null -ne $existing) {
        if (-not ($ReplaceEmpty -and [string]::IsNullOrWhiteSpace($existing))) { return }
        # Replace an empty `KEY=` placeholder line in place.
        $content = [System.IO.File]::ReadAllText($FilePath)
        $pattern = "(?m)^{0}=[ \t]*\r?$" -f [regex]::Escape($Key)
        $content = [regex]::Replace($content, $pattern, ("{0}={1}" -f $Key, $Value), [System.Text.RegularExpressions.RegexOptions]::None, [TimeSpan]::FromSeconds(2))
        Write-EnvFileText -FilePath $FilePath -Content $content
    } else {
        $prefix = ""
        if (Test-Path $FilePath) {
            $raw = [System.IO.File]::ReadAllText($FilePath)
            if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { $prefix = "`n" }
        }
        [System.IO.File]::AppendAllText($FilePath, ("{0}{1}={2}`n" -f $prefix, $Key, $Value))
    }
    if ($Secret) {
        Write-Info ("  set {0} ({1})" -f $Key, (Get-SecretFingerprint -Value $Value))
    } else {
        Write-Info ("  set {0}={1}" -f $Key, $Value)
    }
}

function Resolve-StackPorts {
    $rootEnv = Join-Path $script:RepoRoot ".env"
    $portMap = @(
        @{ Key = "APP_PORT"; Variable = "AppPort" },
        @{ Key = "OM_DEV_SPLASH_PORT"; Variable = "SplashPort" },
        @{ Key = "MCP_PORT"; Variable = "McpPort" },
        @{ Key = "OPENCODE_PORT"; Variable = "OpencodePort" },
        @{ Key = "KEYCLOAK_PORT"; Variable = "KeycloakPort" }
    )
    foreach ($entry in $portMap) {
        $value = Get-EnvValue -FilePath $rootEnv -Key $entry.Key
        $parsed = 0
        if ($value -and [int]::TryParse($value.Trim(), [ref]$parsed) -and $parsed -gt 0) {
            Set-Variable -Scope Script -Name $entry.Variable -Value $parsed
        }
    }
}

function Initialize-EnvFiles {
    Write-StepHeader "Environment files (.env)" "instant; secrets are generated once and never overwritten"
    $rootEnv = Join-Path $script:RepoRoot ".env"
    $appEnvExample = Join-Path $script:RepoRoot "apps\mercato\.env.example"
    $appEnv = Join-Path $script:RepoRoot "apps\mercato\.env"

    if ($DryRun) {
        Write-Info "Would ensure $rootEnv and $appEnv exist with generated secrets (fill-missing-only)."
        return
    }

    $postgresVolumeExists = $false
    try {
        $volumes = (Invoke-NativeCapture "docker" @("volume", "ls", "--format", "{{.Name}}")) -split "\r?\n" | ForEach-Object { $_.Trim() }
        $postgresVolumeExists = ($volumes -contains "mercato-postgres-data-local")
    } catch {}

    if (-not (Test-Path $rootEnv)) {
        Write-EnvFileText -FilePath $rootEnv -Content "# Open Mercato compose environment (generated by start-windows.bat)`n"
        Write-Info "Created $rootEnv"
    }

    $jwtSecret = Get-EnvValue -FilePath $rootEnv -Key "JWT_SECRET"
    if ([string]::IsNullOrWhiteSpace($jwtSecret)) { $jwtSecret = Get-SecretHex 32 }

    Add-EnvValue -FilePath $rootEnv -Key "JWT_SECRET" -Value $jwtSecret -Secret
    Add-EnvValue -FilePath $rootEnv -Key "TENANT_DATA_ENCRYPTION_FALLBACK_KEY" -Value (Get-SecretHex 16) -Secret
    Add-EnvValue -FilePath $rootEnv -Key "MEILISEARCH_MASTER_KEY" -Value (Get-SecretHex 16) -Secret
    Add-EnvValue -FilePath $rootEnv -Key "APP_URL" -Value ("http://localhost:{0}" -f $script:AppPort)
    Add-EnvValue -FilePath $rootEnv -Key "OM_INIT_SUPERADMIN_EMAIL" -Value "superadmin@acme.com"
    if ($postgresVolumeExists) {
        # An initialized database volume already exists; changing credentials in
        # .env now would break auth against the data inside the volume.
        if ($null -eq (Get-EnvValue -FilePath $rootEnv -Key "OM_INIT_SUPERADMIN_PASSWORD")) {
            Write-Warn "Existing postgres volume detected - keeping compose default credentials (superadmin password 'password'). Use -Reset for a clean slate."
        }
        if ([string]::IsNullOrWhiteSpace((Get-EnvValue -FilePath $rootEnv -Key "POSTGRES_PASSWORD"))) {
            Write-Warn "Existing postgres volume but no POSTGRES_PASSWORD in .env - the app will try the compose default ('postgres'), which only works if the volume was created with it. If the app crash-loops on database auth, restore the original .env or run -Reset (deletes all data)."
        }
    } else {
        Add-EnvValue -FilePath $rootEnv -Key "OM_INIT_SUPERADMIN_PASSWORD" -Value (Get-SecretHex 8) -Secret
        Add-EnvValue -FilePath $rootEnv -Key "POSTGRES_PASSWORD" -Value (Get-SecretHex 16) -Secret
    }
    # NOTE: MCP_SERVER_API_KEY is intentionally NOT generated here. The mcp
    # service provisions a real DB-backed key into the shared volume; a random
    # env value would shadow it and break OpenCode -> MCP authentication.

    if (-not (Test-Path $appEnv)) {
        if (Test-Path $appEnvExample) {
            # Replace known placeholder secrets in the freshly created copy only.
            $content = Get-Content $appEnvExample -Raw
            $content = $content -replace "(?m)^JWT_SECRET=.*$", ("JWT_SECRET={0}" -f $jwtSecret)
            $content = $content -replace "(?m)^AUTH_SECRET=.*$", ("AUTH_SECRET={0}" -f (Get-SecretHex 32))
            $content = $content -replace "(?m)^LOOKUP_HASH_PEPPER=.*$", ("LOOKUP_HASH_PEPPER={0}" -f (Get-SecretHex 16))
            Write-EnvFileText -FilePath $appEnv -Content $content
            Write-Info "Created $appEnv from .env.example (placeholder secrets replaced)"
        } else {
            Write-Warn "apps\mercato\.env.example not found; skipping app .env creation"
        }
    } else {
        Write-Ok "apps\mercato\.env already exists (left untouched)"
    }

    Resolve-StackPorts
    Write-Ok "Environment files ready"
}

# ---------------------------------------------------------------------------
# LLM provider prompt
# ---------------------------------------------------------------------------

# Every OM-supported chat provider (from apps/mercato/.env.example). Embedding-
# only providers (Mistral, Cohere, AWS Bedrock) are intentionally excluded — the
# assistant needs a chat model. `KeyEnv`/`Provider` map to the OM_AI_PROVIDER id
# and the provider's API-key var; `BaseUrlEnv` is the *_BASE_URL var when the
# backend has one; `KeyRequired`/`BaseUrlRequired` drive the prompt; `BaseUrl`
# pre-fills a sensible default the user can accept.
$script:LlmProviders = @(
    @{ Provider = "openai";     Label = "OpenAI";                      KeyEnv = "OPENAI_API_KEY";                BaseUrlEnv = "OPENAI_BASE_URL";     KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. gpt-5-mini" },
    @{ Provider = "anthropic";  Label = "Anthropic (Claude)";          KeyEnv = "ANTHROPIC_API_KEY";             BaseUrlEnv = $null;                 KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. claude-haiku-4-5-20251001" },
    @{ Provider = "google";     Label = "Google Gemini";               KeyEnv = "GOOGLE_GENERATIVE_AI_API_KEY";  BaseUrlEnv = $null;                 KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. gemini-3-flash" },
    @{ Provider = "azure";      Label = "Azure OpenAI / AI Foundry";   KeyEnv = "AZURE_OPENAI_API_KEY";          BaseUrlEnv = "AZURE_OPENAI_BASE_URL"; KeyRequired = $true;  BaseUrlRequired = $true;  BaseUrl = ""; ModelRequired = $true;  ModelHint = "your Azure deployment name" },
    @{ Provider = "openrouter"; Label = "OpenRouter (gateway)";        KeyEnv = "OPENROUTER_API_KEY";            BaseUrlEnv = "OPENROUTER_BASE_URL"; KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. meta-llama/llama-3.3-70b-instruct" },
    @{ Provider = "deepinfra";  Label = "DeepInfra";                   KeyEnv = "DEEPINFRA_API_KEY";             BaseUrlEnv = "DEEPINFRA_BASE_URL";  KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. zai-org/GLM-5.1" },
    @{ Provider = "groq";       Label = "Groq";                        KeyEnv = "GROQ_API_KEY";                  BaseUrlEnv = "GROQ_BASE_URL";       KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. llama-3.3-70b-versatile" },
    @{ Provider = "together";   Label = "Together AI";                 KeyEnv = "TOGETHER_API_KEY";              BaseUrlEnv = "TOGETHER_BASE_URL";   KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    @{ Provider = "fireworks";  Label = "Fireworks AI";                KeyEnv = "FIREWORKS_API_KEY";             BaseUrlEnv = "FIREWORKS_BASE_URL";  KeyRequired = $true;  BaseUrlRequired = $false; BaseUrl = ""; ModelRequired = $false; ModelHint = "e.g. accounts/fireworks/models/llama-v3p3-70b-instruct" },
    @{ Provider = "litellm";    Label = "LiteLLM (self-hosted proxy)"; KeyEnv = "LITELLM_API_KEY";               BaseUrlEnv = "LITELLM_BASE_URL";    KeyRequired = $true;  BaseUrlRequired = $true;  BaseUrl = ""; ModelRequired = $true;  ModelHint = "model name as configured in your proxy" },
    @{ Provider = "ollama";     Label = "Ollama (local)";              KeyEnv = "OLLAMA_API_KEY";                BaseUrlEnv = "OLLAMA_BASE_URL";     KeyRequired = $false; BaseUrlRequired = $true;  BaseUrl = "http://host.docker.internal:11434/v1"; ModelRequired = $true; ModelHint = "e.g. llama3.3" },
    @{ Provider = "lm-studio";  Label = "LM Studio (local)";           KeyEnv = "LM_STUDIO_API_KEY";             BaseUrlEnv = "LM_STUDIO_BASE_URL";  KeyRequired = $false; BaseUrlRequired = $true;  BaseUrl = "http://host.docker.internal:1234/v1"; ModelRequired = $true; ModelHint = "the loaded model id" }
)

function Read-SecretValue {
    param([string]$Prompt)
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Set-AiProviderConfig {
    # Writes the provider key + optional base URL + OM_AI_PROVIDER, and OM_AI_MODEL
    # only when a model was supplied. For providers with a good runtime default
    # (OpenAI, Anthropic, ...) we leave OM_AI_MODEL unset so the platform can move
    # its default forward; for providers that have no universal default (Azure
    # deployment names, local model ids) the model is required and pinned here.
    param([hashtable]$Entry, [string]$KeyValue, [string]$BaseUrl = "", [string]$Model = "")
    $rootEnv = Join-Path $script:RepoRoot ".env"
    if (-not [string]::IsNullOrWhiteSpace($KeyValue)) {
        Add-EnvValue -FilePath $rootEnv -Key $Entry.KeyEnv -Value $KeyValue.Trim() -Secret -ReplaceEmpty
    }
    if ($Entry.BaseUrlEnv -and -not [string]::IsNullOrWhiteSpace($BaseUrl)) {
        Add-EnvValue -FilePath $rootEnv -Key $Entry.BaseUrlEnv -Value $BaseUrl.Trim() -ReplaceEmpty
    }
    Add-EnvValue -FilePath $rootEnv -Key "OM_AI_PROVIDER" -Value $Entry.Provider -ReplaceEmpty
    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        Add-EnvValue -FilePath $rootEnv -Key "OM_AI_MODEL" -Value $Model.Trim() -ReplaceEmpty
    }
}

function Invoke-LlmProviderPrompt {
    Write-StepHeader "AI provider (LLM API key)" "waits for your input; have a provider API key ready"
    $rootEnv = Join-Path $script:RepoRoot ".env"

    # A provider can be fully configured WITHOUT an API key (Ollama, LM
    # Studio) - keys alone are not the "already configured" signal.
    # OM_AI_PROVIDER in .env is: without this check every re-run would prompt
    # again, and -NonInteractive re-runs of a working stack would fail.
    $configuredProvider = Get-EnvValue -FilePath $rootEnv -Key "OM_AI_PROVIDER"
    if (-not [string]::IsNullOrWhiteSpace($configuredProvider)) {
        Write-Ok ("AI already configured: provider '{0}' (from .env)" -f $configuredProvider.Trim())
        return
    }

    # Already configured, in .env or the ambient environment?
    foreach ($entry in $script:LlmProviders) {
        $fromFile = Get-EnvValue -FilePath $rootEnv -Key $entry.KeyEnv
        if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
            Write-Ok ("AI already configured: {0}" -f $entry.Label)
            return
        }
        $fromEnv = [Environment]::GetEnvironmentVariable($entry.KeyEnv)
        if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
            if (-not $DryRun) {
                $baseFromEnv = if ($entry.BaseUrlEnv) { [Environment]::GetEnvironmentVariable($entry.BaseUrlEnv) } else { "" }
                Set-AiProviderConfig -Entry $entry -KeyValue $fromEnv -BaseUrl $baseFromEnv
            }
            Write-Ok ("AI configured from environment: {0}" -f $entry.Label)
            return
        }
    }

    if ($DryRun) {
        Write-Info "Would require one LLM provider (OpenAI, Anthropic, Google, Azure, OpenRouter, DeepInfra, Groq, Together, Fireworks, LiteLLM, Ollama, or LM Studio)."
        return
    }

    # Explicit opt-out for automation or configure-later. The ONLY way to skip.
    if ($SkipLlmPrompt) {
        Write-Warn "-SkipLlmPrompt set with no LLM key - AI chat will not work until you set a provider (e.g. OPENAI_API_KEY) in .env and restart the opencode container."
        return
    }

    # Non-interactive with no key and no explicit opt-out: fail fast rather
    # than stand up a stack whose whole purpose (the AI assistant) is dead.
    if ($NonInteractive) {
        Write-Fail "No LLM provider API key found. Set a provider key (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY / AZURE_OPENAI_API_KEY) in the environment or .env, or pass -SkipLlmPrompt to proceed without AI."
    }

    Write-Host ""
    Write-Host "The AI assistant (OpenCode + MCP) needs one LLM provider to power the Cmd+K agent." -ForegroundColor Cyan
    Write-Host "Setup requires one to continue. (Ctrl+C aborts; re-run later with -SkipLlmPrompt to configure it in .env yourself.)"

    while ($true) {
        Write-Host ""
        for ($i = 0; $i -lt $script:LlmProviders.Count; $i++) {
            Write-Host ("  [{0,2}] {1}" -f ($i + 1), $script:LlmProviders[$i].Label)
        }
        $choice = Read-Host ("Choose a provider [1-{0}]" -f $script:LlmProviders.Count)
        $index = 0
        if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $script:LlmProviders.Count) {
            Write-Host ("Please enter a number between 1 and {0}." -f $script:LlmProviders.Count) -ForegroundColor Yellow
            continue
        }
        $selected = $script:LlmProviders[$index - 1]

        # API key (required for hosted providers; optional for local backends).
        $plainKey = ""
        if ($selected.KeyRequired) {
            $plainKey = Read-SecretValue ("Paste your {0} API key (input hidden)" -f $selected.Label)
            if ([string]::IsNullOrWhiteSpace($plainKey)) {
                Write-Host "A key is required for this provider. Try again." -ForegroundColor Yellow
                continue
            }
        } else {
            $plainKey = Read-SecretValue ("{0} API key (optional for local servers - press Enter to skip)" -f $selected.Label)
        }

        # Base URL where the backend needs one. Local providers pre-fill a
        # host.docker.internal default so the container can reach the host.
        $baseUrl = ""
        if ($selected.BaseUrlEnv) {
            $default = $selected.BaseUrl
            $promptText = if ($selected.BaseUrlRequired) {
                if ($default) { "{0} base URL [{1}]" -f $selected.Label, $default } else { "{0} base URL (required)" -f $selected.Label }
            } else {
                "{0} base URL (optional - press Enter for the provider default)" -f $selected.Label
            }
            $entered = Read-Host $promptText
            $baseUrl = if ([string]::IsNullOrWhiteSpace($entered)) { $default } else { $entered.Trim() }
            if ($selected.BaseUrlRequired -and [string]::IsNullOrWhiteSpace($baseUrl)) {
                Write-Host "This provider requires a base URL. Try again." -ForegroundColor Yellow
                continue
            }
        }

        # Model: required where there is no universal default (Azure deployment,
        # local model ids); optional elsewhere (blank keeps the platform default).
        $model = ""
        $modelPrompt = if ($selected.ModelRequired) {
            "{0} model ({1}) (required)" -f $selected.Label, $selected.ModelHint
        } else {
            "{0} model ({1}) (optional - press Enter for the default)" -f $selected.Label, $selected.ModelHint
        }
        $model = (Read-Host $modelPrompt).Trim()
        if ($selected.ModelRequired -and [string]::IsNullOrWhiteSpace($model)) {
            Write-Host "This provider needs a model/deployment id. Try again." -ForegroundColor Yellow
            continue
        }

        Set-AiProviderConfig -Entry $selected -KeyValue $plainKey -BaseUrl $baseUrl -Model $model
        Write-Ok ("AI provider configured: {0}" -f $selected.Label)
        break
    }
}

# ---------------------------------------------------------------------------
# Compose lifecycle + health
# ---------------------------------------------------------------------------

function Invoke-Compose {
    # Streams the command's output to the console (so `ps`, `logs`, and error
    # diagnostics are actually visible) and returns only the exit code.
    #
    # Docker Compose writes benign warnings ("variable is not set, defaulting
    # to a blank string") and build/pull progress to stderr. Under
    # $ErrorActionPreference='Stop' those native stderr lines would otherwise
    # be promoted to terminating errors and abort setup, so the call runs under
    # 'Continue' and merges stderr into the visible host stream via 2>&1.
    param([string[]]$Arguments)
    $composeFilePath = Join-Path $script:RepoRoot $script:ComposeFile
    $composeExe = Resolve-ComposeExe
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $capturedOutput = @()
    try {
        if ($composeExe) {
            & $composeExe --project-directory $script:RepoRoot -f $composeFilePath @Arguments 2>&1 | Tee-Object -Variable capturedOutput | Out-Host
        } else {
            & docker compose --project-directory $script:RepoRoot -f $composeFilePath @Arguments 2>&1 | Tee-Object -Variable capturedOutput | Out-Host
        }
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    $exitCode = $LASTEXITCODE
    # Keep the tail for post-mortem pattern matching (e.g. TLS interception
    # detection); errors surface at the end, and full build logs can be huge.
    $script:LastComposeOutput = (@($capturedOutput) | Select-Object -Last 400 | Out-String)
    return $exitCode
}

function Get-ComposeServiceHealth {
    # Returns @{ service = @{Health;State;ExitCode} } parsed from `compose ps
    # --format json`, tolerating NDJSON (compose >= 2.21) and array output.
    $composeFilePath = Join-Path $script:RepoRoot $script:ComposeFile
    $composeExe = Resolve-ComposeExe
    $raw = if ($composeExe) {
        (Invoke-NativeCapture $composeExe @("--project-directory", $script:RepoRoot, "-f", $composeFilePath, "ps", "--format", "json")).Trim()
    } else {
        (Invoke-NativeCapture "docker" @("compose", "--project-directory", $script:RepoRoot, "-f", $composeFilePath, "ps", "--format", "json")).Trim()
    }
    $entries = @()
    if ($raw.StartsWith("[")) {
        try { $entries = @($raw | ConvertFrom-Json) } catch {}
    } else {
        foreach ($line in ($raw -split "`n" | Where-Object { $_.Trim() })) {
            try { $entries += ($line | ConvertFrom-Json) } catch {}
        }
    }
    $info = @{}
    foreach ($entry in $entries) {
        if ($entry.Service) {
            $info[$entry.Service] = @{
                Health   = $entry.Health
                State    = $entry.State
                ExitCode = $entry.ExitCode
            }
        }
    }
    return $info
}

function Test-ServiceCrashLooping {
    # A service stuck in restarting (or repeatedly exiting non-zero) will never
    # become ready - waiting the full budget on it just hides the error.
    param([hashtable]$Info, [string]$Service)
    $svc = $Info[$Service]
    if (-not $svc) { return $false }
    if ($svc.State -eq "restarting") { return $true }
    return ($svc.State -eq "exited" -and $svc.ExitCode -ne 0)
}

function Test-PortConflicts {
    $portMap = @(
        @{ Port = $script:AppPort; Key = "APP_PORT" },
        @{ Port = $script:McpPort; Key = "MCP_PORT" },
        @{ Port = $script:SplashPort; Key = "OM_DEV_SPLASH_PORT" },
        @{ Port = $script:OpencodePort; Key = "OPENCODE_PORT" },
        @{ Port = $script:KeycloakPort; Key = "KEYCLOAK_PORT" }
    )
    foreach ($entry in $portMap) {
        try {
            $connections = Get-NetTCPConnection -LocalPort $entry.Port -State Listen -ErrorAction SilentlyContinue
            foreach ($conn in $connections) {
                $ownerProcess = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
                $processName = if ($ownerProcess) { $ownerProcess.ProcessName } else { "pid $($conn.OwningProcess)" }
                if ($processName -notmatch "docker|com\.docker|vpnkit|wslrelay") {
                    Write-Warn "Port $($entry.Port) is already in use by '$processName' - compose will fail to bind it. Close that program, or set $($entry.Key)=<free port> in the repo-root .env and re-run."
                }
            }
        } catch {}
    }
}

function Start-Stack {
    Write-StepHeader "Start containers (docker compose up)" "seconds on repeat runs; the FIRST run builds images and can take 10+ minutes"
    # Do NOT force --build on every run: the image is built once (Compose builds
    # it when missing), the source is bind-mounted, and dependencies install at
    # container start — so rebuilding the image each launch just repeats ~10 min
    # of work. Pass -Rebuild to force it (Dockerfile / base-image changes).
    $composeArgs = @("up", "-d")
    if ($Rebuild) { $composeArgs += "--build" }

    if ($DryRun) { Write-Info ("Would run: $script:ComposeCmd " + ($composeArgs -join " ")); return }

    Sync-CorporateCerts
    Test-PortConflicts
    if ($Rebuild) {
        Write-Info "Rebuilding images and starting services..."
    } else {
        Write-Info "Starting services (the FIRST run builds images and can take 10+ minutes; later runs are much faster)..."
    }
    $exitCode = Invoke-Compose $composeArgs
    if ($exitCode -ne 0) {
        $shouldRetry = $false
        if (Test-TlsInterceptionSignature $script:LastComposeOutput) {
            $shouldRetry = Repair-TlsInterception
        } elseif (Test-NetworkFailureSignature $script:LastComposeOutput) {
            $shouldRetry = Invoke-BuildNetworkTriage
        }
        if ($shouldRetry) {
            Write-Info "Retrying docker compose up with the exported proxy certificate..."
            $exitCode = Invoke-Compose $composeArgs
        }
    }
    if ($exitCode -ne 0) {
        Write-Fail "docker compose up failed (exit $exitCode). The output above shows the failing step; first-run image builds download from the internet, so corporate proxies/TLS inspection or transient network errors can break them (a TLS-intercepting proxy's root CA can be trusted via docker\certs\ - see docker\certs\README.md; starters\docker\windows\check-windows.bat audits the whole machine read-only) - re-running start-windows.bat resumes from the failed step. Inspect further with: $script:ComposeCmd logs --tail 100"
    }
    Write-Ok "Containers started"
}

function Wait-ForInfra {
    Write-StepHeader "Infrastructure health (postgres, redis, meilisearch)" "usually 30-60 seconds"
    if ($DryRun) { Write-Info "Would wait for postgres/redis/meilisearch healthchecks."; return }

    $startedAt = Get-Date
    $deadline = $startedAt.AddSeconds(300)
    $services = @("postgres", "redis", "meilisearch")
    $crashTicks = @{}
    while ((Get-Date) -lt $deadline) {
        $info = Get-ComposeServiceHealth
        $healthyCount = @($services | Where-Object { $info[$_] -and $info[$_].Health -eq "healthy" }).Count
        if ($healthyCount -ge $services.Count) {
            Write-Host ""
            Write-Ok "Infrastructure services healthy"
            return
        }
        foreach ($service in $services) {
            if (Test-ServiceCrashLooping -Info $info -Service $service) { $crashTicks[$service] = 1 + [int]$crashTicks[$service] }
            else { $crashTicks[$service] = 0 }
            if ($crashTicks[$service] -ge 3) {
                Write-Host ""
                Write-Host "--- last logs: $service ---" -ForegroundColor DarkGray
                [void](Invoke-Compose @("logs", "--tail", "40", $service))
                Write-Fail "The '$service' container is crash-looping (it keeps exiting right after start) - the error is in the logs above. A common cause is credentials in .env not matching an existing data volume (use -Reset for a clean slate). Containers keep restarting in the background; stop them with stop-windows.bat, fix the cause, then re-run start-windows.bat."
            }
        }
        Write-WaitTick -StartedAt $startedAt -Message ("waiting for databases to report healthy ({0}/{1} ready)" -f $healthyCount, $services.Count)
        Start-Sleep -Seconds 5
    }
    Write-Host ""

    foreach ($service in $services) {
        Write-Host ""
        Write-Host "--- last logs: $service ---" -ForegroundColor DarkGray
        [void](Invoke-Compose @("logs", "--tail", "20", $service))
    }
    Write-Fail "Infrastructure services did not become healthy within 5 minutes."
}

function Wait-ForApp {
    Write-StepHeader "Application readiness (first boot installs + builds + seeds)" "~10 minutes on first boot (up to ~20 on slow disks); seconds afterwards"
    $appUrl = "http://localhost:$script:AppPort"
    $splashStatusUrl = "http://localhost:$script:SplashPort/status"
    if ($DryRun) { Write-Info "Would wait up to $TimeoutMinutes minutes for $appUrl."; return }

    if (Test-HttpListening $appUrl 10) {
        Write-Ok "App is already serving on $appUrl"
        return
    }

    $startedAt = Get-Date
    $deadline = $startedAt.AddMinutes($TimeoutMinutes)
    $splashDownSince = $null
    $lastActivity = ""
    $appCrashTicks = 0

    Write-Host ""
    Write-Host "The FIRST boot installs dependencies, builds every package, and seeds the" -ForegroundColor Cyan
    Write-Host "database inside the container. This commonly takes 10 minutes (up to ~20 on a" -ForegroundColor Cyan
    Write-Host "slow disk / connection) - it is NOT stuck. The build progress page on" -ForegroundColor Cyan
    Write-Host "http://localhost:$script:SplashPort is blank until the install finishes; that's expected." -ForegroundColor Cyan
    Write-Host "You can watch the raw logs in another terminal with:" -ForegroundColor Cyan
    Write-Host "  $script:ComposeCmd logs -f app" -ForegroundColor DarkGray
    Write-Host ""
    Write-Info "Waiting for the app (progress from build splash on :$script:SplashPort; budget ${TimeoutMinutes}m)..."
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpListening $appUrl 5) {
            Write-Host ""
            Write-Ok ("App is up after {0:mm\:ss}" -f ((Get-Date) - $startedAt))
            return
        }

        $statusLine = "installing dependencies & building (first boot, ~10 min - not stuck)"
        try {
            $splash = Invoke-RestMethod -Uri $splashStatusUrl -TimeoutSec 5
            $splashDownSince = $null
            if ($splash.failed) {
                Write-Host ""
                [void](Invoke-Compose @("logs", "--tail", "100", "app"))
                Write-Fail "The dev runtime reported a failure. See app logs above; re-run start-windows.bat to retry (build progress is preserved in Docker volumes)."
            }
            if ($splash.activities) {
                $latest = @($splash.activities) | Select-Object -Last 1
                if ($latest -and $latest.label) { $lastActivity = $latest.label }
                elseif ($latest) { $lastActivity = [string]$latest }
            }
            if ($lastActivity) { $statusLine = $lastActivity }
        } catch {
            if (-not $splashDownSince) { $splashDownSince = Get-Date }
        }

        $info = Get-ComposeServiceHealth
        if (Test-ServiceCrashLooping -Info $info -Service "app") { $appCrashTicks++ } else { $appCrashTicks = 0 }
        if ($appCrashTicks -ge 3) {
            Write-Host ""
            [void](Invoke-Compose @("logs", "--tail", "100", "app"))
            Write-Fail "The app container is crash-looping (it keeps exiting right after start) - the real error is in the logs above (often a failed install/build or a database init error). Containers keep restarting in the background; stop them with stop-windows.bat, fix the cause, then re-run start-windows.bat."
        }

        Write-WaitTick -StartedAt $startedAt -Message $statusLine
        Start-Sleep -Seconds 5
    }

    Write-Host ""
    [void](Invoke-Compose @("logs", "--tail", "100", "app"))
    Write-Fail "App did not become ready within $TimeoutMinutes minutes. See logs above and $script:ResolvedLogPath. Re-run start-windows.bat to retry - progress is preserved in Docker volumes."
}

function Wait-ForAgenticServices {
    Write-StepHeader "Agentic services (MCP :$script:McpPort, OpenCode :$script:OpencodePort)" "1-3 minutes after the app is up"
    if ($DryRun) { Write-Info "Would wait for MCP and OpenCode health endpoints."; return }

    $mcpHealthUrl = "http://localhost:$script:McpPort/health"
    $opencodeHealthUrl = "http://localhost:$script:OpencodePort/global/health"
    $startedAt = Get-Date
    $deadline = $startedAt.AddMinutes(10)
    $mcpReady = $false
    $opencodeReady = $false
    $agenticCrashTicks = @{}
    $gaveUp = @{}
    while ((Get-Date) -lt $deadline -and -not (($mcpReady -or $gaveUp["mcp"]) -and ($opencodeReady -or $gaveUp["opencode"]))) {
        if (-not $mcpReady) { $mcpReady = Test-HttpOk $mcpHealthUrl }
        if (-not $opencodeReady) { $opencodeReady = Test-HttpOk $opencodeHealthUrl }
        if (-not ($mcpReady -and $opencodeReady)) {
            $info = Get-ComposeServiceHealth
            foreach ($service in @("mcp", "opencode")) {
                if ($gaveUp[$service]) { continue }
                if (Test-ServiceCrashLooping -Info $info -Service $service) { $agenticCrashTicks[$service] = 1 + [int]$agenticCrashTicks[$service] }
                else { $agenticCrashTicks[$service] = 0 }
                if ($agenticCrashTicks[$service] -ge 3) {
                    Write-Host ""
                    Write-Host "--- last logs: $service ---" -ForegroundColor DarkGray
                    [void](Invoke-Compose @("logs", "--tail", "40", $service))
                    Write-Warn "The '$service' container is crash-looping - see its logs above. The rest of the stack keeps working; fix the cause and run: $script:ComposeCmd restart $service"
                    $gaveUp[$service] = $true
                }
            }
            $waitingOn = @()
            if (-not $mcpReady -and -not $gaveUp["mcp"]) { $waitingOn += "MCP" }
            if (-not $opencodeReady -and -not $gaveUp["opencode"]) { $waitingOn += "OpenCode" }
            if ($waitingOn.Count -gt 0) {
                Write-WaitTick -StartedAt $startedAt -Message ("waiting for {0} (they start after the app; the MCP key is provisioned automatically)" -f ($waitingOn -join " + "))
            }
            Start-Sleep -Seconds 5
        }
    }
    Write-Host ""

    if ($mcpReady) { Write-Ok "MCP server healthy ($mcpHealthUrl)" }
    else { Write-Warn "MCP server not healthy yet - check: $script:ComposeCmd logs mcp" }
    if ($opencodeReady) { Write-Ok "OpenCode healthy ($opencodeHealthUrl)" }
    else { Write-Warn "OpenCode not healthy yet - check: $script:ComposeCmd logs opencode" }

    if ($mcpReady -and $opencodeReady) {
        try {
            $mcpStatus = Invoke-RestMethod -Uri "http://localhost:$script:OpencodePort/mcp" -TimeoutSec 10
            $connection = $mcpStatus."open-mercato"
            if ($connection -and $connection.status -eq "connected") {
                Write-Ok "OpenCode is connected to the MCP server (end-to-end wiring verified)"
            } else {
                Write-Warn "OpenCode reports MCP status '$($connection.status)' - the key may still be provisioning; it retries automatically."
            }
        } catch {
            Write-Warn "Could not query OpenCode MCP status: $($_.Exception.Message)"
        }
    }
}

function Show-FinalSummary {
    $rootEnv = Join-Path $script:RepoRoot ".env"
    $adminEmail = Get-EnvValue -FilePath $rootEnv -Key "OM_INIT_SUPERADMIN_EMAIL"
    if (-not $adminEmail) { $adminEmail = "superadmin@acme.com" }
    $adminPassword = Get-EnvValue -FilePath $rootEnv -Key "OM_INIT_SUPERADMIN_PASSWORD"
    if (-not $adminPassword) { $adminPassword = "password" }

    function Write-SummaryRow {
        param([string]$Label, [string]$Value, [string]$ValueColor = "White", [string]$Note = "")
        Write-Host ("  {0,-14} " -f $Label) -ForegroundColor Gray -NoNewline
        if ($Note) {
            Write-Host $Value -ForegroundColor $ValueColor -NoNewline
            Write-Host ("  {0}" -f $Note) -ForegroundColor DarkGray
        } else {
            Write-Host $Value -ForegroundColor $ValueColor
        }
    }

    Write-Host ""
    Write-Host "  OPEN" -ForegroundColor DarkCyan -NoNewline
    Write-Host " MERCATO" -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-Host " READY " -BackgroundColor DarkGreen -ForegroundColor White -NoNewline
    Write-Host "  The dev stack is running" -ForegroundColor Green
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-SummaryRow "Admin app:" "http://localhost:$script:AppPort/backend" "Cyan" "<- start here"
    Write-SummaryRow "App root:" "http://localhost:$script:AppPort" "Cyan"
    Write-SummaryRow "Dev splash:" "http://localhost:$script:SplashPort" "Cyan" "(build/status page)"
    Write-SummaryRow "MCP server:" "http://localhost:$script:McpPort/health" "Cyan"
    Write-SummaryRow "OpenCode:" "http://localhost:$script:OpencodePort/global/health" "Cyan"
    Write-SummaryRow "Keycloak:" "http://localhost:$script:KeycloakPort" "Cyan" "(admin/admin, dev SSO)"
    Write-Host ""
    Write-SummaryRow "Superadmin:" "$adminEmail / $adminPassword" "White" "(also stored in the repo-root .env)"
    Write-Host ""
    Write-SummaryRow "Stop:" "stop-windows.bat" "White" "(data preserved)"
    Write-SummaryRow "Restart:" "start-windows.bat" "White" "(reuses the built image)"
    Write-SummaryRow "Rebuild image:" "powershell starters\docker\windows\start-dev.ps1 -Rebuild" "White" "(after a Dockerfile change)"
    Write-SummaryRow "Logs:" "$script:ComposeCmd logs -f app" "White"
    Write-SummaryRow "Full reset:" "powershell starters\docker\windows\start-dev.ps1 -Reset" "White" "(DELETES all data)"
    if ($script:ResolvedLogPath) {
        Write-SummaryRow "Setup log:" $script:ResolvedLogPath "White"
    }
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-Host ""
    Write-Host "  Try the AI assistant: open " -ForegroundColor Cyan -NoNewline
    Write-Host "http://localhost:$script:AppPort/backend" -ForegroundColor White -NoNewline
    Write-Host ", log in, press Ctrl+K" -ForegroundColor Cyan
    Write-Host "  and ask: 'What tools do you have?'" -ForegroundColor Cyan

    if ($script:Warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "Warnings:" -ForegroundColor Yellow
        foreach ($warning in $script:Warnings) {
            Write-Host "  - $warning" -ForegroundColor Yellow
        }
    }
}

# ---------------------------------------------------------------------------
# Secondary actions (-Stop / -Restart / -Status / -Logs / -Reset)
# ---------------------------------------------------------------------------

function Invoke-SecondaryAction {
    if (-not $script:RepoRoot) {
        Write-Fail "Not inside an Open Mercato repository - secondary actions need the repo."
    }
    Resolve-StackPorts
    $actionLabel = if ($Stop) { "Stop the dev stack" }
        elseif ($Restart) { "Restart the dev stack" }
        elseif ($Status) { "Stack status" }
        elseif ($Logs) { "Application logs (Ctrl+C to stop following)" }
        else { "Full reset" }
    Show-MiniBanner $actionLabel

    $engineReady = Test-DockerEngineReady
    if (-not $engineReady) {
        # Read-only / teardown actions must not drag Docker Desktop up (30-60s
        # start + a multi-GB WSL VM) just to say the stack is down.
        if ($Status) {
            Write-Section "Stack status"
            Write-Ok "Docker engine is not running - the stack is stopped."
            return
        }
        if ($Logs -or $Stop) {
            Write-Ok "Docker engine is not running - nothing to $(if ($Logs) { 'tail' } else { 'stop' })."
            return
        }
        Start-DockerEngine
    }

    if ($Stop) {
        Write-Section "Stopping the dev stack (data preserved in volumes)"
        [void](Invoke-Compose @("down"))
        Write-Ok "Stack stopped. Start again with start-windows.bat"
        return
    }
    if ($Restart) {
        Write-Section "Restarting the dev stack"
        [void](Invoke-Compose @("down"))
        [void](Invoke-Compose @("up", "-d"))
        Write-Ok "Stack restarted"
        return
    }
    if ($Status) {
        Write-Section "Stack status"
        [void](Invoke-Compose @("ps"))
        foreach ($probe in @(
            @{ Name = "App"; Url = "http://localhost:$script:AppPort" },
            @{ Name = "MCP"; Url = "http://localhost:$script:McpPort/health" },
            @{ Name = "OpenCode"; Url = "http://localhost:$script:OpencodePort/global/health" }
        )) {
            if (Test-HttpListening $probe.Url) { Write-Ok ("{0} answering at {1}" -f $probe.Name, $probe.Url) }
            else { Write-Warn ("{0} not answering at {1}" -f $probe.Name, $probe.Url) }
        }
        return
    }
    if ($Logs) {
        [void](Invoke-Compose @("logs", "-f", "app"))
        return
    }
    if ($Reset) {
        Write-Section "FULL RESET - this deletes the database and all volumes"
        if (-not $Yes) {
            if ($NonInteractive) { Write-Fail "-Reset requires -Yes in non-interactive mode." }
            $confirmation = Read-Host "Type the repo name ('open-mercato') to confirm deletion of ALL data"
            if ($confirmation -ne "open-mercato") { Write-Fail "Confirmation did not match; reset aborted." }
        }
        [void](Invoke-Compose @("down", "-v"))
        Write-Ok "All containers and volumes removed. Run start-windows.bat for a fresh setup."
        return
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if ($Elevated) {
    # Elevated child: only the admin-required install work, then exit.
    try {
        Invoke-ElevatedInstallPhase
    } catch {
        Write-Host "Elevated phase failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

try {
    Initialize-Logging
    Clear-RunOnceEntry

    $script:RepoRoot = Resolve-RepoRoot
    if ($script:RepoRoot) {
        Resolve-StackPorts
        if (-not $LauncherPath) {
            $candidateLauncher = Join-Path $script:RepoRoot "starters\docker\windows\start-windows.bat"
            if (Test-Path $candidateLauncher) { $LauncherPath = $candidateLauncher }
        }
    }

    if ($Stop -or $Restart -or $Status -or $Logs -or $Reset) {
        Invoke-SecondaryAction
        Complete-Logging
        exit 0
    }

    Show-Banner
    if ($DryRun) { Write-Host "   DRY RUN - nothing will be installed or changed." -ForegroundColor Yellow }

    # Step: OS + virtualization preflight
    Write-StepHeader "Preflight (Windows version, virtualization)" "instant"
    # AppLocker/WDAC Constrained Language Mode breaks .NET calls this script
    # depends on (TLS setup, crypto RNG, file IO) with cryptic mid-run errors -
    # detect it up-front with an actionable message instead.
    $languageMode = $ExecutionContext.SessionState.LanguageMode
    if ("$languageMode" -ne "FullLanguage") {
        Write-Fail "PowerShell is running in $languageMode mode (an AppLocker/WDAC policy). The launcher needs FullLanguage mode - ask IT to allow this script (or run it from an exempted path), then re-run."
    }
    $build = [System.Environment]::OSVersion.Version.Build
    if ($build -lt 19041) {
        Write-Fail "Windows build $build is too old. WSL2/Docker Desktop need Windows 10 2004 (build 19041) or Windows 11."
    }
    if (-not (Test-VirtualizationEnabled)) {
        Write-Fail "CPU virtualization appears disabled. Enable Intel VT-x / AMD-V (SVM) in your BIOS/UEFI settings, then re-run."
    }
    # Resource floor: the full containerized stack needs ~8-10 GB inside the
    # WSL2 VM plus headroom for Windows itself, and the first run downloads
    # images + fills dependency volumes. Probe failures skip the check.
    $script:TotalRamGb = 0
    try {
        $script:TotalRamGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    } catch {}
    $freeDiskGb = -1
    try {
        $systemDriveName = ($env:SystemDrive -replace ":", "")
        $freeDiskGb = [math]::Round((Get-PSDrive -Name $systemDriveName -ErrorAction Stop).Free / 1GB, 1)
    } catch {}
    if ($script:TotalRamGb -gt 0 -or $freeDiskGb -ge 0) {
        Write-Host ("  RAM: {0} GB   Free disk ({1}): {2} GB" -f $script:TotalRamGb, $env:SystemDrive, $freeDiskGb)
    }
    if ($script:TotalRamGb -gt 0) {
        if ($script:TotalRamGb -lt 12 -and -not $SkipResourceCheck) {
            Write-Fail "This machine has $($script:TotalRamGb) GB RAM; the full containerized stack needs 12 GB minimum (16 GB recommended). Use the infra-only compose (docker-compose.yml) with a native dev setup instead - or accept the OOM risk with -SkipResourceCheck."
        } elseif ($script:TotalRamGb -lt 12) {
            Write-Warn "Only $($script:TotalRamGb) GB RAM (-SkipResourceCheck given) - expect out-of-memory crash-loops; 12 GB is the working minimum, 16 GB recommended."
        } elseif ($script:TotalRamGb -lt 16) {
            Write-Warn "This machine has $($script:TotalRamGb) GB RAM - the stack fits, but 16 GB is recommended; keep other heavy apps closed during the first build."
        }
    }
    if ($freeDiskGb -ge 0) {
        if ($freeDiskGb -lt 20 -and -not $SkipResourceCheck) {
            Write-Fail "Only $freeDiskGb GB free on $env:SystemDrive - the first run needs ~20 GB (images, dependency volumes, the WSL2 virtual disk). Free up space, then re-run - or override with -SkipResourceCheck."
        } elseif ($freeDiskGb -lt 20) {
            Write-Warn "Only $freeDiskGb GB free on $env:SystemDrive (-SkipResourceCheck given) - the first build may run out of disk."
        } elseif ($freeDiskGb -lt 40) {
            Write-Warn "$freeDiskGb GB free on $env:SystemDrive - enough to start, but Docker images and volumes grow over time; 40 GB+ free is comfortable."
        }
    }
    if (Test-WingetAvailable) {
        Write-Ok "Windows build $build, virtualization available, winget present"
    } else {
        Write-Warn "winget / App Installer is not available - Git and Docker Desktop will be installed via direct download (no App Installer needed)."
        Write-Ok "Windows build $build, virtualization available"
    }

    # Step: prerequisites (elevated only when something is missing)
    Invoke-InstallPhaseIfNeeded

    if ($IncludeNativeToolchain -and $script:RepoRoot) {
        $nativeScript = Join-Path $script:RepoRoot "starters\hybrid\windows-toolchain.ps1"
        if ((Test-Path $nativeScript) -and -not $DryRun) {
            Write-Info "Running native toolchain setup (-IncludeNativeToolchain)..."
            $nativeChild = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$nativeScript`"") -Verb RunAs -Wait -PassThru
            if ($nativeChild.ExitCode -ne 0) { Write-Warn "Native toolchain setup exited with code $($nativeChild.ExitCode)" }
        }
    }

    # Step: reboot gate (exits with 10 when a restart is pending)
    Invoke-RebootGate

    # Step: WSL2 memory sizing (must land before the engine's first start)
    Ensure-WslMemoryConfig

    # Step: docker engine
    Start-DockerEngine
    Ensure-DockerCompose

    # Step: clone when standalone (re-invokes the in-repo script and exits)
    if (-not $script:RepoRoot) {
        Invoke-StandaloneClone
        # (unreachable - Invoke-StandaloneClone always exits)
    }

    Set-Location $script:RepoRoot

    # Step: .env generation
    Initialize-EnvFiles

    # Step: LLM provider prompt
    Invoke-LlmProviderPrompt

    # Step: compose up
    Start-Stack

    # Step: health checks
    Wait-ForInfra
    Wait-ForApp
    Wait-ForAgenticServices

    if ($DryRun) {
        Write-Section "Dry run complete - no changes were made"
        Complete-Logging
    } else {
        # Stop the transcript BEFORE the summary: the summary prints the
        # superadmin password, which must not persist in the %TEMP% log.
        Complete-Logging
        Show-FinalSummary
    }
    exit 0
}
catch {
    Write-Host ""
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:ResolvedLogPath) {
        Write-Host "Log file: $script:ResolvedLogPath" -ForegroundColor Yellow
    }
    Complete-Logging
    Pause-OnFailure
    exit 1
}
