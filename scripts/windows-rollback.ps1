# ============================================================
# windows-rollback.ps1
# Roll back changes made by windows-optimize.ps1.
#
# Run:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows-rollback.ps1
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
$GitKeysAdded = @(
    "core.longpaths",
    "core.autocrlf",
    "core.eol",
    "core.fscache",
    "core.preloadindex"
)
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

function Contains-Value($values, $target) {
    if ($null -eq $values) { return $false }
    return @($values) -contains $target
}

function Get-StateGitValue($state, $key) {
    $property = $state.gitGlobal.PSObject.Properties[$key]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Restore-GitGlobalValue($key, $value) {
    if ($null -eq $value) {
        git config --global --unset $key 2>&1 | Out-Null
        Write-Ok "Removed git config: $key"
        Add-ReportItem $ExecutedActions "Removed git config: $key"
    } else {
        git config --global $key $value
        Write-Ok "Restored git config: $key = $value"
        Add-ReportItem $ExecutedActions "Restored git config: $key = $value"
    }
}

function Show-Plan($state) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "  Windows optimization rollback for open-mercato" -ForegroundColor Magenta
    Write-Host "  Project: $ProjectRoot" -ForegroundColor Gray
    Write-Host "  State file: $StateFile" -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "This script will roll back these changes:" -ForegroundColor White
    Write-Host "  1. Remove Microsoft Defender exclusions added by optimization, unless they existed before." -ForegroundColor Gray
    foreach ($path in $DesiredExclusionPaths) { Write-Host "     - path: $path" -ForegroundColor DarkGray }
    foreach ($proc in $DesiredExclusionProcesses) { Write-Host "     - process: $proc" -ForegroundColor DarkGray }
    Write-Host "  2. Restore LongPathsEnabled to the previous value: $($state.longPathsEnabled)" -ForegroundColor Gray
    Write-Host "  3. Restore these global Git config values from the state file:" -ForegroundColor Gray
    foreach ($key in $GitKeysAdded) {
        Write-Host "     - $key = $(Get-StateGitValue $state $key)" -ForegroundColor DarkGray
    }
    Write-Host "  4. Restore user-level NODE_OPTIONS to the previous value." -ForegroundColor Gray
    Write-Host "  5. Delete the rollback state file after a completed rollback." -ForegroundColor Gray
    Write-Host ""
}

function Confirm-Execution {
    if ($Force) {
        Write-Warn "Force mode enabled. Skipping confirmation prompt."
        return $true
    }

    $confirm = Read-Host "Continue with rollback? [y/N]"
    return $confirm -match "^[yY]$"
}

function Show-Summary {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "  Windows rollback summary" -ForegroundColor Magenta
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
    Write-Host "Restart your terminal so environment variable changes take effect." -ForegroundColor Yellow
    Write-Host ""
}

if (-not (Test-Path -LiteralPath $StateFile)) {
    Write-Warn "State file not found: $StateFile"
    Write-Warn "Rollback cannot know which settings existed before optimization, so it will not guess."
    Write-Host "Run rollback with the state file generated by windows-optimize.ps1." -ForegroundColor Yellow
    exit 1
}

$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
Show-Plan $state

if (-not (Test-IsAdministrator)) {
    Write-Warn "Administrator privileges are required for Defender exclusions and HKLM registry changes."
    $elevate = Read-Host "Relaunch this script as Administrator now? [y/N]"
    if ($elevate -match "^[yY]$") {
        Start-ElevatedSelf
        Write-Host "`nOpened an elevated PowerShell window. Continue there." -ForegroundColor Yellow
        exit 0
    }

    Write-Fail "Cancelled. No changes were rolled back."
    exit 1
}

if (-not (Confirm-Execution)) {
    Write-Host "`nCancelled. No changes were rolled back." -ForegroundColor Yellow
    exit 0
}

Write-Step "Microsoft Defender exclusions"
foreach ($path in $DesiredExclusionPaths) {
    if (Contains-Value $state.defenderExclusionPaths $path) {
        Write-Info "Keeping pre-existing path exclusion: $path"
        Add-ReportItem $SkippedActions "Kept pre-existing Defender path exclusion: $path"
        continue
    }

    try {
        Remove-MpPreference -ExclusionPath $path -ErrorAction Stop
        Write-Ok "Removed path exclusion: $path"
        Add-ReportItem $ExecutedActions "Removed Defender path exclusion: $path"
    } catch {
        Write-Info "Path exclusion was absent or could not be removed: $path"
        Add-ReportItem $SkippedActions "Path exclusion absent or not removable: $path"
    }
}

foreach ($proc in $DesiredExclusionProcesses) {
    if (Contains-Value $state.defenderExclusionProcesses $proc) {
        Write-Info "Keeping pre-existing process exclusion: $proc"
        Add-ReportItem $SkippedActions "Kept pre-existing Defender process exclusion: $proc"
        continue
    }

    try {
        Remove-MpPreference -ExclusionProcess $proc -ErrorAction Stop
        Write-Ok "Removed process exclusion: $proc"
        Add-ReportItem $ExecutedActions "Removed Defender process exclusion: $proc"
    } catch {
        Write-Info "Process exclusion was absent or could not be removed: $proc"
        Add-ReportItem $SkippedActions "Process exclusion absent or not removable: $proc"
    }
}

Write-Step "Windows long paths"
try {
    $current = Get-ItemPropertyValue "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" -ErrorAction Stop
    if ($null -eq $state.longPathsEnabled) {
        Write-Info "No previous LongPathsEnabled value in state file. Skipping."
        Add-ReportItem $SkippedActions "Skipped LongPathsEnabled restore because previous value was not captured"
    } elseif ($current -ne [int]$state.longPathsEnabled) {
        Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value ([int]$state.longPathsEnabled) -Type DWord
        Write-Ok "Restored LongPathsEnabled to $($state.longPathsEnabled)"
        Add-ReportItem $ExecutedActions "Restored LongPathsEnabled to $($state.longPathsEnabled)"
    } else {
        Write-Info "LongPathsEnabled already has previous value $($state.longPathsEnabled)"
        Add-ReportItem $SkippedActions "LongPathsEnabled already had previous value"
    }
} catch {
    Write-Warn "Could not read or restore LongPathsEnabled: $($_.Exception.Message)"
    Add-ReportItem $FailedActions "Could not restore LongPathsEnabled"
}

Write-Step "Git global configuration"
foreach ($key in $GitKeysAdded) {
    try {
        Restore-GitGlobalValue $key (Get-StateGitValue $state $key)
    } catch {
        Write-Warn "Could not restore $key`: $($_.Exception.Message)"
        Add-ReportItem $FailedActions "Could not restore git config: $key"
    }
}

Write-Step "NODE_OPTIONS"
try {
    $previousNodeOptions = $state.nodeOptionsUser
    if ($null -eq $previousNodeOptions) {
        [System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", $null, [System.EnvironmentVariableTarget]::User)
        Write-Ok "Removed NODE_OPTIONS because it was not set before optimization"
        Add-ReportItem $ExecutedActions "Removed user NODE_OPTIONS"
    } else {
        [System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", [string]$previousNodeOptions, [System.EnvironmentVariableTarget]::User)
        Write-Ok "Restored NODE_OPTIONS to the previous value"
        Add-ReportItem $ExecutedActions "Restored user NODE_OPTIONS"
    }
} catch {
    Write-Warn "Could not restore NODE_OPTIONS: $($_.Exception.Message)"
    Add-ReportItem $FailedActions "Could not restore user NODE_OPTIONS"
}

if ($FailedActions.Count -eq 0) {
    try {
        Remove-Item -LiteralPath $StateFile -Force -ErrorAction Stop
        Write-Ok "Deleted rollback state file: $StateFile"
        Add-ReportItem $ExecutedActions "Deleted rollback state file"
    } catch {
        Write-Warn "Could not delete rollback state file: $($_.Exception.Message)"
        Add-ReportItem $FailedActions "Could not delete rollback state file"
    }
} else {
    Write-Warn "Keeping rollback state file because one or more rollback steps failed: $StateFile"
    Add-ReportItem $SkippedActions "Kept rollback state file after failed rollback steps"
}

Show-Summary
