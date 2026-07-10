# One-command Windows launcher for the fully containerized Open Mercato dev
# stack (app :3000, mcp :3001, opencode :4096, postgres/redis/meilisearch).
#
# Designed for a clean Windows machine: installs Git and Docker Desktop via
# winget, enables WSL2, handles the reboot-and-resume cycle, clones the repo
# when run standalone, generates .env secrets, optionally prompts for an LLM
# provider API key, starts docker compose, waits for health, and prints a
# summary. Every step is idempotent and driven by live probes, so re-running
# the script (or start-windows.bat) is always safe.
#
# Unlike scripts/setup-windows-dev.ps1 (native toolchain: Node, Build Tools),
# this launcher needs NO Node.js on the host. Pass -IncludeNativeToolchain to
# additionally run the native toolchain setup script.
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
    [int]$TimeoutMinutes = 30,
    [string]$LogPath = "",

    # Internal parameters (used by the launcher and self-relaunches)
    [string]$LauncherPath = "",
    [switch]$Elevated,
    [string]$RepoPathForExclusion = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:ComposeFile = "docker-compose.fullapp.dev.yml"
$script:RunOnceKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
$script:RunOnceName = "OpenMercatoDevSetup"
$script:RestartRequired = $false
$script:Warnings = [System.Collections.Generic.List[string]]::new()
$script:TranscriptStarted = $false
$script:ResolvedLogPath = $null
$script:RepoRoot = $null
$script:StepNumber = 0
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
# Output helpers (mirrors scripts/setup-windows-dev.ps1 conventions)
# ---------------------------------------------------------------------------

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    Write-Host $Message -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Write-StepHeader {
    param([string]$Message)
    $script:StepNumber++
    Write-Section ("Step {0}: {1}" -f $script:StepNumber, $Message)
}

function Write-Info {
    param([string]$Message)
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
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

# ---------------------------------------------------------------------------
# Repo detection / secrets
# ---------------------------------------------------------------------------

function Resolve-RepoRoot {
    $candidate = $null
    if ($PSScriptRoot -and ($PSScriptRoot -match "\\scripts\\windows$")) {
        $candidate = Resolve-Path (Join-Path $PSScriptRoot "..\..") -ErrorAction SilentlyContinue
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
# Server SKUs, and many locked-down corporate images). Git and Docker Desktop
# both publish stable official installers we can fetch and run silently.
# ---------------------------------------------------------------------------

function Get-RemoteFile {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [string]$DisplayName = "file"
    )
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Info "Downloading $DisplayName..."
    try {
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers @{ "User-Agent" = "open-mercato-setup" }
    } catch {
        Write-Fail "Download of $DisplayName failed: $($_.Exception.Message). Behind a corporate proxy, configure the proxy for this session (e.g. netsh winhttp import proxy) or download it manually."
    }
    if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -lt 1024) {
        Write-Fail "Downloaded $DisplayName is missing or too small - the download likely failed or was blocked by a proxy/firewall."
    }
}

function Install-GitDirect {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $assetUrl = $null
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -UseBasicParsing -Headers @{ "User-Agent" = "open-mercato-setup" }
        $asset = $release.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
        if ($asset) { $assetUrl = $asset.browser_download_url }
    } catch {
        Write-Fail "Could not resolve the latest Git for Windows installer: $($_.Exception.Message). Install Git manually from https://git-scm.com/download/win and re-run."
    }
    if (-not $assetUrl) { Write-Fail "No 64-bit Git installer found in the latest release. Install Git manually from https://git-scm.com/download/win and re-run." }

    $installer = Join-Path $env:TEMP "git-for-windows-64.exe"
    Get-RemoteFile -Url $assetUrl -OutFile $installer -DisplayName "Git for Windows"
    Write-Info "Installing Git (silent)..."
    $proc = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT', '/NORESTART', '/SP-', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/CLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS' -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Git installer exited with code $($proc.ExitCode). Install Git manually from https://git-scm.com/download/win and re-run." }
}

function Install-DockerDesktopDirect {
    $installer = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
    Get-RemoteFile -Url "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $installer -DisplayName "Docker Desktop (~500 MB)"
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
        & winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements --disable-interactivity
        if ($LASTEXITCODE -eq 0) { [void](Test-GitInstalled); return }
        Write-Warn "winget could not install Git (exit $LASTEXITCODE) - falling back to a direct download."
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
        & winget install --id Docker.DockerDesktop --exact --accept-package-agreements --accept-source-agreements --override "install --quiet --accept-license --backend=wsl-2"
        if ($LASTEXITCODE -eq 0) { return }
        Write-Warn "winget could not install Docker Desktop (exit $LASTEXITCODE) - falling back to a direct download."
    } else {
        Write-Info "winget unavailable - installing Docker Desktop via direct download..."
    }
    Install-DockerDesktopDirect
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
    & wsl --status *> $null
    return ($LASTEXITCODE -eq 0)
}

function Test-DockerDesktopInstalled {
    return (Test-Path (Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"))
}

function Test-DockerEngineReady {
    if (-not (Test-CommandAvailable "docker")) { return $false }
    & docker info 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-ElevatedInstallPhase {
    # Runs inside the elevated child process (-Elevated). Performs only the
    # admin-required work, then exits: 0 = done, 10 = reboot required.
    Write-Section "Elevated install phase"

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
        & git config --global core.autocrlf input
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
        & wsl --set-default-version 2 2>$null | Out-Null
        & wsl --update 2>$null | Out-Null
    }
    Write-Ok "WSL2 features ensured"

    if (-not (Test-DockerDesktopInstalled)) {
        Install-DockerViaBestMethod -HasWinget $hasWinget
        $script:RestartRequired = $true
    }
    Write-Ok "Docker Desktop present"

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
    Write-StepHeader "Prerequisites (Git, WSL2, Docker Desktop)"

    if ($SkipInstall) {
        Write-Info "Skipping prerequisite installation (-SkipInstall)."
        if (-not (Test-DockerDesktopInstalled)) {
            Write-Fail "Docker Desktop is not installed and -SkipInstall was passed."
        }
        return
    }

    $needsGit = -not (Test-GitInstalled)
    $needsWsl = -not (Test-WslFeaturesEnabled)
    $needsDocker = -not (Test-DockerDesktopInstalled)
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

    if (-not ($needsGit -or $needsWsl -or $needsDocker -or $needsExclusion)) {
        Write-Ok "All prerequisites already installed"
        return
    }

    $missingItems = @()
    if ($needsGit) { $missingItems += "Git" }
    if ($needsWsl) { $missingItems += "WSL2 features" }
    if ($needsDocker) { $missingItems += "Docker Desktop" }
    if ($needsExclusion) { $missingItems += "Defender exclusion" }

    if ($DryRun) {
        Write-Info ("Would install (elevated): {0}" -f ($missingItems -join ", "))
        return
    }

    Write-Info ("Administrator rights are needed for: {0}. A UAC prompt will appear." -f ($missingItems -join ", "))

    $exclusionArg = if ($script:RepoRoot) { $script:RepoRoot } else { Join-Path $CloneRoot $RepoName }
    $childArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
        "-Elevated",
        "-RepoPathForExclusion", "`"$exclusionArg`""
    )
    if ($SkipDefenderExclusion) { $childArgs += "-SkipDefenderExclusion" }
    if ($NonInteractive) { $childArgs += "-NonInteractive" }

    $child = Start-Process -FilePath "powershell" -ArgumentList $childArgs -Verb RunAs -Wait -PassThru
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
    Write-StepHeader "Reboot check"
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
# Docker engine
# ---------------------------------------------------------------------------

function Start-DockerEngine {
    Write-StepHeader "Docker engine"
    if (Test-DockerEngineReady) {
        Write-Ok "Docker engine is running"
        return
    }
    if ($DryRun) { Write-Info "Would start Docker Desktop and wait for the engine."; return }

    $desktopExe = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
    $running = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
    if (-not $running -and (Test-Path $desktopExe)) {
        Write-Info "Starting Docker Desktop..."
        Start-Process -FilePath $desktopExe | Out-Null
    }

    $deadline = (Get-Date).AddSeconds(300)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerEngineReady) {
            Write-Ok "Docker engine is ready"
            return
        }
        Start-Sleep -Seconds 5
    }

    Write-Fail "Docker engine did not become ready within 5 minutes. Open Docker Desktop from the Start menu, finish any first-run dialogs (sign-in can be skipped), then re-run start-windows.bat. Log: $script:ResolvedLogPath"
}

# ---------------------------------------------------------------------------
# Standalone clone
# ---------------------------------------------------------------------------

function Invoke-StandaloneClone {
    Write-StepHeader "Clone repository"
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
            $answer = Read-Host "Clone Open Mercato into '$targetPath'? [Y/n]"
            if ($answer -match "^[Nn]") { Write-Fail "Clone declined. Re-run with -CloneRoot/-RepoName to choose another location." }
        }
        Write-Info "Cloning $RepoUrl (branch $Branch)..."
        & git clone --branch $Branch $RepoUrl $targetPath
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "git clone failed (exit $LASTEXITCODE). Check network/proxy access to github.com."
        }
        Write-Ok "Cloned into $targetPath"
    }

    # Continue on the cloned tree's own launcher so future logic always runs
    # from the repo copy.
    $inRepoScript = Join-Path $targetPath "scripts\windows\start-dev.ps1"
    $inRepoLauncher = Join-Path $targetPath "start-windows.bat"
    if (-not (Test-Path $inRepoScript)) {
        Write-Fail "Cloned repo does not contain scripts\windows\start-dev.ps1 (branch too old?)."
    }
    Write-Info "Re-entering setup from the cloned repository..."
    $forward = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$inRepoScript`"", "-LauncherPath", "`"$inRepoLauncher`"")
    if ($NonInteractive) { $forward += "-NonInteractive" }
    if ($DryRun) { $forward += "-DryRun" }
    if ($SkipInstall) { $forward += "-SkipInstall" }
    if ($SkipLlmPrompt) { $forward += "-SkipLlmPrompt" }
    if ($Rebuild) { $forward += "-Rebuild" }
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
    Write-StepHeader "Environment files (.env)"
    $rootEnv = Join-Path $script:RepoRoot ".env"
    $appEnvExample = Join-Path $script:RepoRoot "apps\mercato\.env.example"
    $appEnv = Join-Path $script:RepoRoot "apps\mercato\.env"

    if ($DryRun) {
        Write-Info "Would ensure $rootEnv and $appEnv exist with generated secrets (fill-missing-only)."
        return
    }

    $postgresVolumeExists = $false
    try {
        $volumes = & docker volume ls --format "{{.Name}}" 2>$null
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
    Write-StepHeader "AI provider (LLM API key)"
    $rootEnv = Join-Path $script:RepoRoot ".env"

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
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker compose -f $composeFilePath @Arguments 2>&1 | Out-Host
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    return $LASTEXITCODE
}

function Get-ComposeServiceHealth {
    # Returns @{ service = health } parsed from `compose ps --format json`,
    # tolerating both NDJSON (compose >= 2.21) and single-array output.
    $raw = (& docker compose -f (Join-Path $script:RepoRoot $script:ComposeFile) ps --format json 2>$null | Out-String).Trim()
    $entries = @()
    if ($raw.StartsWith("[")) {
        try { $entries = @($raw | ConvertFrom-Json) } catch {}
    } else {
        foreach ($line in ($raw -split "`n" | Where-Object { $_.Trim() })) {
            try { $entries += ($line | ConvertFrom-Json) } catch {}
        }
    }
    $health = @{}
    foreach ($entry in $entries) {
        if ($entry.Service) { $health[$entry.Service] = $entry.Health }
    }
    return $health
}

function Test-PortConflicts {
    $ports = @($script:AppPort, $script:McpPort, $script:SplashPort, $script:OpencodePort, $script:KeycloakPort)
    foreach ($port in $ports) {
        try {
            $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            foreach ($conn in $connections) {
                $ownerProcess = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
                $processName = if ($ownerProcess) { $ownerProcess.ProcessName } else { "pid $($conn.OwningProcess)" }
                if ($processName -notmatch "docker|com\.docker|vpnkit|wslrelay") {
                    Write-Warn "Port $port is already in use by '$processName' - the stack may fail to bind it."
                }
            }
        } catch {}
    }
}

function Start-Stack {
    Write-StepHeader "Start containers (docker compose up)"
    # Do NOT force --build on every run: the image is built once (Compose builds
    # it when missing), the source is bind-mounted, and dependencies install at
    # container start — so rebuilding the image each launch just repeats ~10 min
    # of work. Pass -Rebuild to force it (Dockerfile / base-image changes).
    $composeArgs = @("up", "-d")
    if ($Rebuild) { $composeArgs += "--build" }

    if ($DryRun) { Write-Info ("Would run: docker compose -f $script:ComposeFile " + ($composeArgs -join " ")); return }

    Test-PortConflicts
    if ($Rebuild) {
        Write-Info "Rebuilding images and starting services..."
    } else {
        Write-Info "Starting services (the FIRST run builds images and can take 10+ minutes; later runs are much faster)..."
    }
    $exitCode = Invoke-Compose $composeArgs
    if ($exitCode -ne 0) {
        Write-Fail "docker compose up failed (exit $exitCode). Inspect with: docker compose -f $script:ComposeFile logs --tail 100"
    }
    Write-Ok "Containers started"
}

function Wait-ForInfra {
    Write-StepHeader "Infrastructure health (postgres, redis, meilisearch)"
    if ($DryRun) { Write-Info "Would wait for postgres/redis/meilisearch healthchecks."; return }

    $deadline = (Get-Date).AddSeconds(300)
    $services = @("postgres", "redis", "meilisearch")
    while ((Get-Date) -lt $deadline) {
        $health = Get-ComposeServiceHealth
        $healthyCount = @($services | Where-Object { $health[$_] -eq "healthy" }).Count
        if ($healthyCount -ge $services.Count) {
            Write-Ok "Infrastructure services healthy"
            return
        }
        Start-Sleep -Seconds 5
    }

    foreach ($service in $services) {
        Write-Host ""
        Write-Host "--- last logs: $service ---" -ForegroundColor DarkGray
        [void](Invoke-Compose @("logs", "--tail", "20", $service))
    }
    Write-Fail "Infrastructure services did not become healthy within 5 minutes."
}

function Wait-ForApp {
    Write-StepHeader "Application readiness (first boot installs + builds + seeds)"
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

    Write-Host ""
    Write-Host "The FIRST boot installs dependencies, builds every package, and seeds the" -ForegroundColor Cyan
    Write-Host "database inside the container. This commonly takes 10 minutes (up to ~20 on a" -ForegroundColor Cyan
    Write-Host "slow disk / connection) - it is NOT stuck. The build progress page on" -ForegroundColor Cyan
    Write-Host "http://localhost:$script:SplashPort is blank until the install finishes; that's expected." -ForegroundColor Cyan
    Write-Host "You can watch the raw logs in another terminal with:" -ForegroundColor Cyan
    Write-Host "  docker compose -f $script:ComposeFile logs -f app" -ForegroundColor DarkGray
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

        $elapsed = "{0:mm\:ss}" -f ((Get-Date) - $startedAt)
        Write-Host ("`r[{0}] {1}   " -f $elapsed, $statusLine) -NoNewline
        Start-Sleep -Seconds 5
    }

    Write-Host ""
    [void](Invoke-Compose @("logs", "--tail", "100", "app"))
    Write-Fail "App did not become ready within $TimeoutMinutes minutes. See logs above and $script:ResolvedLogPath. Re-run start-windows.bat to retry - progress is preserved in Docker volumes."
}

function Wait-ForAgenticServices {
    Write-StepHeader "Agentic services (MCP :$script:McpPort, OpenCode :$script:OpencodePort)"
    if ($DryRun) { Write-Info "Would wait for MCP and OpenCode health endpoints."; return }

    $mcpHealthUrl = "http://localhost:$script:McpPort/health"
    $opencodeHealthUrl = "http://localhost:$script:OpencodePort/global/health"
    $deadline = (Get-Date).AddMinutes(10)
    $mcpReady = $false
    $opencodeReady = $false
    while ((Get-Date) -lt $deadline -and -not ($mcpReady -and $opencodeReady)) {
        if (-not $mcpReady) { $mcpReady = Test-HttpOk $mcpHealthUrl }
        if (-not $opencodeReady) { $opencodeReady = Test-HttpOk $opencodeHealthUrl }
        if (-not ($mcpReady -and $opencodeReady)) { Start-Sleep -Seconds 5 }
    }

    if ($mcpReady) { Write-Ok "MCP server healthy ($mcpHealthUrl)" }
    else { Write-Warn "MCP server not healthy yet - check: docker compose -f $script:ComposeFile logs mcp" }
    if ($opencodeReady) { Write-Ok "OpenCode healthy ($opencodeHealthUrl)" }
    else { Write-Warn "OpenCode not healthy yet - check: docker compose -f $script:ComposeFile logs opencode" }

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

    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-Host " Open Mercato dev stack is running" -ForegroundColor Green
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-Host "  Admin app:     http://localhost:$script:AppPort/backend"
    Write-Host "  App root:      http://localhost:$script:AppPort"
    Write-Host "  Dev splash:    http://localhost:$script:SplashPort            (build/status page)"
    Write-Host "  MCP server:    http://localhost:$script:McpPort/health"
    Write-Host "  OpenCode:      http://localhost:$script:OpencodePort/global/health"
    Write-Host "  Keycloak:      http://localhost:$script:KeycloakPort            (admin/admin, dev SSO)"
    Write-Host ""
    Write-Host "  Superadmin:    $adminEmail / $adminPassword"
    Write-Host ""
    Write-Host "  Stop:          stop-windows.bat"
    Write-Host "  Restart:       start-windows.bat                                 (reuses the built image)"
    Write-Host "  Rebuild image: powershell scripts\windows\start-dev.ps1 -Rebuild (after a Dockerfile change)"
    Write-Host "  Logs:          docker compose -f $script:ComposeFile logs -f app"
    Write-Host "  Full reset:    powershell scripts\windows\start-dev.ps1 -Reset   (DELETES all data)"
    if ($script:ResolvedLogPath) {
        Write-Host "  Setup log:     $script:ResolvedLogPath"
    }
    Write-Host ("=" * 78) -ForegroundColor Green
    Write-Host ""
    Write-Host "Try the AI assistant: open http://localhost:$script:AppPort/backend, log in, press Cmd/Ctrl+K" -ForegroundColor Cyan
    Write-Host "and ask: 'What tools do you have?'" -ForegroundColor Cyan

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
            $candidateLauncher = Join-Path $script:RepoRoot "start-windows.bat"
            if (Test-Path $candidateLauncher) { $LauncherPath = $candidateLauncher }
        }
    }

    if ($Stop -or $Restart -or $Status -or $Logs -or $Reset) {
        Invoke-SecondaryAction
        Complete-Logging
        exit 0
    }

    Write-Section "Open Mercato - one-command Windows dev environment"
    if ($script:RepoRoot) { Write-Info "Repository: $script:RepoRoot" }
    else { Write-Info "Standalone mode: repository will be cloned to $(Join-Path $CloneRoot $RepoName)" }
    if ($DryRun) { Write-Info "DRY RUN - nothing will be installed or changed." }

    # Step: OS + virtualization preflight
    Write-StepHeader "Preflight (Windows version, virtualization)"
    $build = [System.Environment]::OSVersion.Version.Build
    if ($build -lt 19041) {
        Write-Fail "Windows build $build is too old. WSL2/Docker Desktop need Windows 10 2004 (build 19041) or Windows 11."
    }
    if (-not (Test-VirtualizationEnabled)) {
        Write-Fail "CPU virtualization appears disabled. Enable Intel VT-x / AMD-V (SVM) in your BIOS/UEFI settings, then re-run."
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
        $nativeScript = Join-Path $script:RepoRoot "scripts\setup-windows-dev.ps1"
        if ((Test-Path $nativeScript) -and -not $DryRun) {
            Write-Info "Running native toolchain setup (-IncludeNativeToolchain)..."
            $nativeChild = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$nativeScript`"") -Verb RunAs -Wait -PassThru
            if ($nativeChild.ExitCode -ne 0) { Write-Warn "Native toolchain setup exited with code $($nativeChild.ExitCode)" }
        }
    }

    # Step: reboot gate (exits with 10 when a restart is pending)
    Invoke-RebootGate

    # Step: docker engine
    Start-DockerEngine

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
