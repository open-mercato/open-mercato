# ============================================================
# windows-optimize.ps1
# Windows optimization for the open-mercato Node.js monorepo.
#
# Run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows-optimize.ps1
#
# If needed, the script relaunches itself as Administrator after showing the plan.
# ============================================================

param(
    [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$StateFile = Join-Path $ProjectRoot ".mercato\windows-optimize-state.json"
$DesiredExclusionPaths = @(
    $ProjectRoot,
    "$env:APPDATA\npm",
    "$env:APPDATA\npm-cache",
    "$env:LOCALAPPDATA\Yarn",
    "$env:LOCALAPPDATA\pnpm",
    "$env:USERPROFILE\.yarn",
    "$env:USERPROFILE\.turbo",
    "$env:USERPROFILE\.node_modules",
    "C:\Program Files\nodejs"
)
$DesiredExclusionProcesses = @("node.exe", "yarn.js", "turbo.exe")
$GitConfigs = @{
    "core.longpaths"    = "true"
    "core.autocrlf"     = "false"
    "core.eol"          = "lf"
    "core.fscache"      = "true"
    "core.preloadindex" = "true"
}
$NodeOptionsFlag = "--max-old-space-size=4096"
$ExecutedActions = New-Object System.Collections.Generic.List[string]
$SkippedActions = New-Object System.Collections.Generic.List[string]
$FailedActions = New-Object System.Collections.Generic.List[string]

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   [X]  $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "   [i]  $msg" -ForegroundColor Gray }

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedSelf {
    $argumentList = @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "`"$PSCommandPath`"",
        "-ProjectRoot",
        "`"$ProjectRoot`""
    )

    if ($Force) {
        $argumentList += "-Force"
    }

    Start-Process powershell -Verb RunAs -ArgumentList $argumentList
}

function Add-ReportItem($collection, $message) {
    $collection.Add($message) | Out-Null
}

function Get-GitGlobalValue($key) {
    $value = git config --global --get $key 2>$null
    if ($LASTEXITCODE -eq 0) { return $value }
    return $null
}

function Save-OptimizeState {
    if (Test-Path -LiteralPath $StateFile) {
        Write-Warn "State file already exists. Keeping previous rollback state: $StateFile"
        Add-ReportItem $SkippedActions "Kept existing rollback state file"
        return
    }

    $defenderExclusionPaths = @()
    $defenderExclusionProcesses = @()
    try {
        $prefs = Get-MpPreference -ErrorAction Stop
        $defenderExclusionPaths = @($prefs.ExclusionPath)
        $defenderExclusionProcesses = @($prefs.ExclusionProcess)
    } catch {
        Write-Fail "Could not capture existing Microsoft Defender exclusions: $($_.Exception.Message)"
        throw "Aborting because rollback would not be able to preserve pre-existing Defender exclusions."
    }

    $longPaths = $null
    try {
        $longPaths = Get-ItemPropertyValue "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" -ErrorAction Stop
    } catch {
        Write-Warn "Could not capture previous LongPathsEnabled value: $($_.Exception.Message)"
    }

    $gitState = @{}
    foreach ($key in $GitConfigs.Keys) {
        $gitState[$key] = Get-GitGlobalValue $key
    }

    $state = [PSCustomObject]@{
        createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        projectRoot = $ProjectRoot
        defenderExclusionPaths = $defenderExclusionPaths
        defenderExclusionProcesses = $defenderExclusionProcesses
        longPathsEnabled = $longPaths
        gitGlobal = $gitState
        nodeOptionsUser = [System.Environment]::GetEnvironmentVariable("NODE_OPTIONS", "User")
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $StateFile -Parent) | Out-Null
    $state | ConvertTo-Json -Depth 5 | Out-File -FilePath $StateFile -Encoding UTF8
    Write-Ok "Saved rollback state: $StateFile"
    Add-ReportItem $ExecutedActions "Saved rollback state"
}

function Merge-NodeOptions($existing, $flag) {
    if ([string]::IsNullOrWhiteSpace($existing)) {
        return $flag
    }
    if ($existing -match '(^|\s)--max-old-space-size(=|\s|$)') {
        return $existing
    }
    return "$existing $flag"
}

function Show-Plan {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "  Windows optimization for open-mercato" -ForegroundColor Magenta
    Write-Host "  Project: $ProjectRoot" -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "This script will make these changes:" -ForegroundColor White
    Write-Host "  1. Save rollback state to: $StateFile" -ForegroundColor Gray
    Write-Host "  2. Add Microsoft Defender exclusions for these paths:" -ForegroundColor Gray
    foreach ($path in $DesiredExclusionPaths) { Write-Host "     - $path" -ForegroundColor DarkGray }
    Write-Host "  3. Add Microsoft Defender process exclusions:" -ForegroundColor Gray
    foreach ($proc in $DesiredExclusionProcesses) { Write-Host "     - $proc" -ForegroundColor DarkGray }
    Write-Host "  4. Enable Windows long paths: LongPathsEnabled = 1" -ForegroundColor Gray
    Write-Host "  5. Set global Git config values:" -ForegroundColor Gray
    foreach ($key in ($GitConfigs.Keys | Sort-Object)) { Write-Host "     - $key = $($GitConfigs[$key])" -ForegroundColor DarkGray }
    Write-Host "  6. Add user-level NODE_OPTIONS flag when missing: $NodeOptionsFlag" -ForegroundColor Gray
    Write-Host ""
    Write-Host "It will not disable Microsoft Defender globally. It only excludes the listed paths and processes from scanning." -ForegroundColor Yellow
    Write-Host ""
}

function Confirm-Execution {
    if ($Force) {
        Write-Warn "Force mode enabled. Skipping confirmation prompt."
        return $true
    }

    $confirm = Read-Host "Continue with these Windows optimizations? [y/N]"
    return $confirm -match "^[yY]$"
}

function Show-Summary {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "  Windows optimization summary" -ForegroundColor Magenta
    Write-Host "============================================================" -ForegroundColor Magenta

    Write-Step "Executed"
    if ($ExecutedActions.Count -eq 0) {
        Write-Info "No actions were executed"
    } else {
        foreach ($action in $ExecutedActions) { Write-Ok $action }
    }

    Write-Step "Skipped"
    if ($SkippedActions.Count -eq 0) {
        Write-Info "No actions were skipped"
    } else {
        foreach ($action in $SkippedActions) { Write-Info $action }
    }

    Write-Step "Failed"
    if ($FailedActions.Count -eq 0) {
        Write-Info "No actions failed"
    } else {
        foreach ($action in $FailedActions) { Write-Warn $action }
    }

    Write-Host ""
    Write-Host "Restart your terminal so user environment variable changes take effect." -ForegroundColor Yellow
    Write-Host "Continue with the standard setup flow from the project documentation." -ForegroundColor White
    Write-Host "Recommended next steps:" -ForegroundColor White
    Write-Host "  1. Open a new terminal" -ForegroundColor Gray
    Write-Host "  2. Follow README.md / AGENTS.md for the task you are doing" -ForegroundColor Gray
    Write-Host "  3. Usually run: yarn install" -ForegroundColor Gray
    Write-Host "  4. Usually run: yarn dev" -ForegroundColor Gray
    Write-Host ""
}

Show-Plan

if (-not (Test-IsAdministrator)) {
    Write-Warn "Administrator privileges are required for Defender exclusions and HKLM registry changes."
    $elevate = Read-Host "Relaunch this script as Administrator now? [y/N]"
    if ($elevate -match "^[yY]$") {
        Start-ElevatedSelf
        Write-Host "`nOpened an elevated PowerShell window. Continue there." -ForegroundColor Yellow
        exit 0
    }

    Write-Fail "Cancelled. No changes were made."
    exit 1
}

if (-not (Confirm-Execution)) {
    Write-Host "`nCancelled. No changes were made." -ForegroundColor Yellow
    exit 0
}

Save-OptimizeState

Write-Step "Microsoft Defender exclusions"
foreach ($path in $DesiredExclusionPaths) {
    try {
        Add-MpPreference -ExclusionPath $path -ErrorAction Stop
        Write-Ok "Path exclusion: $path"
        Add-ReportItem $ExecutedActions "Added Defender path exclusion: $path"
    } catch {
        Write-Warn "Could not add path exclusion: $path ($($_.Exception.Message))"
        Add-ReportItem $FailedActions "Could not add Defender path exclusion: $path"
    }
}

foreach ($proc in $DesiredExclusionProcesses) {
    try {
        Add-MpPreference -ExclusionProcess $proc -ErrorAction Stop
        Write-Ok "Process exclusion: $proc"
        Add-ReportItem $ExecutedActions "Added Defender process exclusion: $proc"
    } catch {
        Write-Warn "Could not add process exclusion: $proc ($($_.Exception.Message))"
        Add-ReportItem $FailedActions "Could not add Defender process exclusion: $proc"
    }
}

Write-Step "Windows long paths"
try {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -Type DWord
    Write-Ok "LongPathsEnabled = 1"
    Add-ReportItem $ExecutedActions "Enabled Windows long paths"
} catch {
    Write-Warn "Could not set LongPathsEnabled: $($_.Exception.Message)"
    Add-ReportItem $FailedActions "Could not enable Windows long paths"
}

Write-Step "Git global configuration"
foreach ($key in ($GitConfigs.Keys | Sort-Object)) {
    try {
        git config --global $key $GitConfigs[$key]
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "git config --global $key = $($GitConfigs[$key])"
            Add-ReportItem $ExecutedActions "Set git config $key = $($GitConfigs[$key])"
        } else {
            Write-Warn "git config failed for $key"
            Add-ReportItem $FailedActions "git config failed for $key"
        }
    } catch {
        Write-Warn "git config failed for $key`: $($_.Exception.Message)"
        Add-ReportItem $FailedActions "git config failed for $key"
    }
}

Write-Step "NODE_OPTIONS"
try {
    $existingNodeOptions = [System.Environment]::GetEnvironmentVariable("NODE_OPTIONS", "User")
    $mergedNodeOptions = Merge-NodeOptions $existingNodeOptions $NodeOptionsFlag
    [System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", $mergedNodeOptions, [System.EnvironmentVariableTarget]::User)

    if ($mergedNodeOptions -eq $existingNodeOptions) {
        Write-Info "NODE_OPTIONS already contains a max-old-space-size flag"
        Add-ReportItem $SkippedActions "NODE_OPTIONS already had a max-old-space-size flag"
    } else {
        Write-Ok "NODE_OPTIONS=$mergedNodeOptions (user-level environment variable)"
        Add-ReportItem $ExecutedActions "Updated user NODE_OPTIONS"
    }
} catch {
    Write-Warn "Could not update NODE_OPTIONS: $($_.Exception.Message)"
    Add-ReportItem $FailedActions "Could not update user NODE_OPTIONS"
}

Write-Step "Tool versions"
$tools = @("node", "yarn", "turbo", "git")
foreach ($tool in $tools) {
    try {
        $version = & $tool --version 2>&1
        Write-Ok "$tool $version"
        Add-ReportItem $ExecutedActions "Verified $tool"
    } catch {
        Write-Warn "$tool was not found in PATH"
        Add-ReportItem $FailedActions "$tool was not found in PATH"
    }
}

Show-Summary
