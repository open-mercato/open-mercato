[CmdletBinding()]
param(
    [string]$CloneRoot = "C:\Development\Hackaton\testspeed",
    [string]$RepoName = "open-mercato",
    [switch]$SkipDefenderExclusion,
    [switch]$SkipDockerStart,
    [switch]$SkipPackageInstalls,
    [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"

$script:RestartRequired = $false
$script:Warnings = [System.Collections.Generic.List[string]]::new()
$script:CompletedSteps = [System.Collections.Generic.List[string]]::new()
$script:IsElevated = $false
$script:TranscriptStarted = $false
$script:ResolvedLogPath = $null

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    Write-Host $Message -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Write-Step {
    param([string]$Message)
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
    [void]$script:CompletedSteps.Add($Message)
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
        $script:ResolvedLogPath = Join-Path $logDirectory ("setup-windows-dev-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    } else {
        $parent = Split-Path -Parent $LogPath
        if ($parent) {
            New-Item -Path $parent -ItemType Directory -Force | Out-Null
        }
        $script:ResolvedLogPath = $LogPath
    }

    Start-Transcript -Path $script:ResolvedLogPath -Force | Out-Null
    $script:TranscriptStarted = $true
    Write-Ok "Transcript log: $script:ResolvedLogPath"
}

function Complete-Logging {
    if ($script:TranscriptStarted) {
        Stop-Transcript | Out-Null
        $script:TranscriptStarted = $false
    }
}

function Pause-OnFailure {
    param([string]$PromptMessage = "Press Enter to close")
    if ($Host.Name -match "ConsoleHost") {
        Read-Host $PromptMessage | Out-Null
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Elevation {
    if (Test-IsAdministrator) {
        $script:IsElevated = $true
        Write-Ok "Running as administrator"
        return
    }

    $commandHint = ".\scripts\setup-windows-dev.ps1"
    Write-Fail "Administrator rights are required. Open PowerShell as Administrator, cd into the repo, and run: $commandHint"
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$DisplayName = $FilePath,
        [switch]$AllowNonZeroExit
    )

    Write-Step ("Running: {0} {1}" -f $FilePath, ($Arguments -join " "))
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE

    if (-not $AllowNonZeroExit -and $exitCode -ne 0) {
        Write-Fail "$DisplayName exited with code $exitCode"
    }

    return $exitCode
}

function Test-CommandAvailable {
    param([Parameter(Mandatory = $true)][string]$CommandName)
    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Ensure-Winget {
    Write-Section "Winget"
    if (Test-CommandAvailable "winget") {
        $version = (& winget --version)
        Write-Ok "Winget available ($version)"
        return
    }

    Write-Fail "Winget is not available. Install App Installer from Microsoft Store and run the script again."
}

function Get-InstalledPackageMatch {
    param([Parameter(Mandatory = $true)][string]$Id)

    $output = (& winget list --id $Id --exact --accept-source-agreements 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    return $output -match [regex]::Escape($Id)
}

function Ensure-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Label,
        [string[]]$AdditionalArgs = @()
    )

    Write-Section $Label

    if (Get-InstalledPackageMatch -Id $Id) {
        Write-Ok "$Label is already installed"
        return
    }

    if ($SkipPackageInstalls) {
        Write-Warn "$Label is not installed and -SkipPackageInstalls skips installation"
        return
    }

    $arguments = @(
        "install"
        "--id", $Id
        "--exact"
        "--accept-package-agreements"
        "--accept-source-agreements"
        "--disable-interactivity"
    ) + $AdditionalArgs

    Invoke-NativeCommand -FilePath "winget" -Arguments $arguments -DisplayName $Label

    if (-not (Get-InstalledPackageMatch -Id $Id)) {
        Write-Fail "$Label is still not detected by winget after installation"
    }

    Write-Ok "$Label installed"
}

function Ensure-WindowsFeature {
    param([Parameter(Mandatory = $true)][string]$FeatureName)

    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName
    if ($feature.State -eq "Enabled") {
        Write-Ok "Windows feature '$FeatureName' is enabled"
        return
    }

    Write-Step "Enabling Windows feature '$FeatureName'"
    Enable-WindowsOptionalFeature -Online -FeatureName $FeatureName -All -NoRestart | Out-Null
    $script:RestartRequired = $true
    Write-Ok "Windows feature '$FeatureName' enabled"
}

function Ensure-Wsl2 {
    Write-Section "WSL 2"

    Ensure-WindowsFeature -FeatureName "Microsoft-Windows-Subsystem-Linux"
    Ensure-WindowsFeature -FeatureName "VirtualMachinePlatform"

    if (-not (Test-CommandAvailable "wsl")) {
        Write-Warn "The wsl command is not available yet. Restart Windows and run the script again."
        $script:RestartRequired = $true
        return
    }

    Invoke-NativeCommand -FilePath "wsl" -Arguments @("--set-default-version", "2") -DisplayName "WSL default version" -AllowNonZeroExit
    Write-Ok "WSL default version set to 2"
}

function Ensure-Node24 {
    Write-Section "Node.js 24"

    $hasNode = Test-CommandAvailable "node"
    if ($hasNode) {
        $version = (& node --version).Trim()
        if ($version -match "^v24\.") {
            Write-Ok "Node.js matches repo requirement ($version)"
            return
        }

        Write-Warn "Detected $version. This repo requires Node.js 24.x."
    }

    Ensure-WingetPackage -Id "OpenJS.NodeJS.LTS" -Label "Node.js LTS"

    if (-not (Test-CommandAvailable "node")) {
        $machineNode = Join-Path ${env:ProgramFiles} "nodejs\node.exe"
        if (Test-Path $machineNode) {
            $env:Path = (Split-Path $machineNode) + ";" + [Environment]::GetEnvironmentVariable("Path", "Process")
        }
    }

    if (-not (Test-CommandAvailable "node")) {
        Write-Fail "Node.js is not available in PATH after installation"
    }

    $installedVersion = (& node --version).Trim()
    if ($installedVersion -notmatch "^v24\.") {
        Write-Fail "Detected $installedVersion after installation, but this repo requires Node.js 24.x"
    }

    Write-Ok "Node.js ready ($installedVersion)"
}

function Ensure-CorepackAndYarn {
    Write-Section "Corepack and Yarn"

    if (Test-CommandAvailable "yarn") {
        $existingYarnVersion = (& yarn --version).Trim()
        if ($existingYarnVersion -eq "4.12.0") {
            Write-Ok "Yarn already available (4.12.0)"
            return
        }

        Write-Warn "Detected Yarn $existingYarnVersion. The script will try to switch to 4.12.0."
    }

    if (-not (Test-CommandAvailable "corepack")) {
        Write-Fail "corepack is not available. Check the Node.js 24.x installation."
    }

    Invoke-NativeCommand -FilePath "corepack" -Arguments @("enable") -DisplayName "corepack enable"
    Invoke-NativeCommand -FilePath "corepack" -Arguments @("prepare", "yarn@4.12.0", "--activate") -DisplayName "corepack prepare yarn@4.12.0"

    if (-not (Test-CommandAvailable "yarn")) {
        Write-Fail "Yarn is not available after Corepack activation"
    }

    $yarnVersion = (& yarn --version).Trim()
    Write-Ok "Yarn ready ($yarnVersion)"
}

function Ensure-Git {
    Write-Section "Git"

    if (-not (Test-CommandAvailable "git")) {
        Ensure-WingetPackage -Id "Git.Git" -Label "Git"
    }

    if (-not (Test-CommandAvailable "git")) {
        Write-Fail "Git is not available in PATH after installation"
    }

    Invoke-NativeCommand -FilePath "git" -Arguments @("config", "--global", "core.autocrlf", "input") -DisplayName "git config core.autocrlf"
    $gitVersion = (& git --version).Trim()
    Write-Ok "Git ready ($gitVersion)"
}

function Ensure-BuildTools {
    Write-Section "Visual Studio 2022 Build Tools"

    $vsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    $buildToolsPath = $null
    if (Test-Path $vsWhere) {
        $buildToolsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath 2>$null
    }

    if ($buildToolsPath) {
        Write-Ok "Visual Studio Build Tools with C++ workload already installed"
        return
    }

    $override = "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    Ensure-WingetPackage -Id "Microsoft.VisualStudio.2022.BuildTools" -Label "Visual Studio 2022 Build Tools" -AdditionalArgs @("--override", $override)

    if (-not (Test-Path $vsWhere)) {
        Write-Fail "vswhere was not found after Build Tools installation"
    }

    $buildToolsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath 2>$null
    if (-not $buildToolsPath) {
        Write-Fail "Build Tools with the C++ workload were not installed correctly"
    }

    Write-Ok "Build Tools with C++ workload ready"
}

function Ensure-VcRedist {
    Ensure-WingetPackage -Id "Microsoft.VCRedist.2015+.x64" -Label "Microsoft Visual C++ Redistributable 2015+ x64"
}

function Ensure-DockerDesktop {
    Write-Section "Docker Desktop"

    Ensure-WingetPackage -Id "Docker.DockerDesktop" -Label "Docker Desktop"

    $dockerExe = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path $dockerExe)) {
        Write-Warn "Docker Desktop was installed, but the executable was not found in the standard location"
        return
    }

    if ($SkipDockerStart) {
        Write-Warn "Skipping Docker Desktop auto-start (-SkipDockerStart)"
        return
    }

    Write-Step "Starting Docker Desktop"
    Start-Process -FilePath $dockerExe | Out-Null

    if (-not (Test-CommandAvailable "docker")) {
        $cliPath = Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin"
        if (Test-Path $cliPath) {
            $env:Path = $cliPath + ";" + [Environment]::GetEnvironmentVariable("Path", "Process")
        }
    }

    if (-not (Test-CommandAvailable "docker")) {
        Write-Warn "Docker CLI is not in PATH for this session yet. It should be available after opening a new terminal."
        return
    }

    $timeout = [TimeSpan]::FromMinutes(5)
    $deadline = (Get-Date).Add($timeout)
    $isReady = $false

    Write-Step "Waiting for Docker Engine to become ready"
    while ((Get-Date) -lt $deadline) {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) {
            $isReady = $true
            break
        }

        Start-Sleep -Seconds 5
        Write-Host "." -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ""

    if ($isReady) {
        Write-Ok "Docker Desktop is running and docker info responds"
    } else {
        Write-Warn "Docker Desktop did not become ready within 5 minutes. If this is the first start, finish the Docker Desktop onboarding manually."
    }
}

function Ensure-DefenderExclusion {
    Write-Section "Microsoft Defender"

    if ($SkipDefenderExclusion) {
        Write-Warn "Skipping Defender exclusion (-SkipDefenderExclusion)"
        return
    }

    $repoPath = Join-Path $CloneRoot $RepoName
    if (-not (Test-Path $repoPath)) {
        Write-Step "Creating target repo directory: $repoPath"
        New-Item -Path $repoPath -ItemType Directory -Force | Out-Null
    }

    $prefs = Get-MpPreference
    if ($prefs.ExclusionPath -contains $repoPath) {
        Write-Ok "Defender exclusion already exists for $repoPath"
        return
    }

    Write-Step "Adding Defender exclusion for $repoPath"
    Add-MpPreference -ExclusionPath $repoPath
    Write-Ok "Defender exclusion added"
}

function Show-Summary {
    Write-Section "Summary"

    foreach ($step in $script:CompletedSteps) {
        Write-Host "  [OK] $step" -ForegroundColor Green
    }

    if ($script:Warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "Warnings:" -ForegroundColor Yellow
        foreach ($warning in $script:Warnings) {
            Write-Host "  - $warning" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Next step:" -ForegroundColor Cyan
    $repoPath = Join-Path $CloneRoot $RepoName
    Write-Host "  git clone https://github.com/open-mercato/open-mercato.git `"$repoPath`"" -ForegroundColor White

    if ($script:RestartRequired) {
        Write-Host ""
        Write-Host "A system restart is required before continuing with Docker/WSL setup." -ForegroundColor Yellow
    }
}

try {
    Initialize-Logging
    Ensure-Elevation
    Ensure-Winget
    Ensure-Wsl2
    Ensure-Node24
    Ensure-CorepackAndYarn
    Ensure-Git
    Ensure-BuildTools
    Ensure-VcRedist
    Ensure-DockerDesktop
    Ensure-DefenderExclusion
    Show-Summary
}
catch {
    Write-Host ""
    Write-Host "Unhandled error: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:ResolvedLogPath) {
        Write-Host "Log file: $script:ResolvedLogPath" -ForegroundColor Yellow
    }
    Pause-OnFailure
    exit 1
}
finally {
    Complete-Logging
}
