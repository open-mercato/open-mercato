#powershell -ExecutionPolicy Bypass -File .\scripts\windows-dev-setup.ps1

[CmdletBinding()]
param(
  [string]$ProjectPath = (Get-Location).Path,
  [switch]$SkipDefenderExclusion,
  [switch]$SkipBuildTools,
  [switch]$SkipVcRedist
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-IsWindowsHost {
  if ($null -ne (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue)) {
    return [bool]$IsWindows
  }

  return [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
}

function Format-Argument {
  param([string]$Value)
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }

  return $Value
}

function Get-ScriptRelaunchArguments {
  $argsList = @(
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    (Format-Argument -Value $PSCommandPath)
    '-ProjectPath'
    (Format-Argument -Value $ProjectPath)
  )

  foreach ($flag in @(
    'SkipDefenderExclusion',
    'SkipBuildTools',
    'SkipVcRedist'
  )) {
    if ($PSBoundParameters.ContainsKey($flag) -and $PSBoundParameters[$flag]) {
      $argsList += "-$flag"
    }
  }

  return ($argsList -join ' ')
}

function Test-WingetPackageInstalled {
  param([Parameter(Mandatory = $true)][string]$Id)

  $output = & winget list --id $Id --exact 2>$null
  return ($LASTEXITCODE -eq 0) -and ($output -match [regex]::Escape($Id))
}

function Invoke-WingetInstall {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$DisplayName,
    [string[]]$AdditionalArguments = @()
  )

  $resolvedName = if ($DisplayName) { $DisplayName } else { $Id }
  if (Test-WingetPackageInstalled -Id $Id) {
    Write-Step "$resolvedName already installed"
    return
  }

  Write-Step "Installing or repairing $resolvedName"
  $arguments = @(
    'install',
    '--id', $Id,
    '--exact',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--silent',
    '--disable-interactivity'
  ) + $AdditionalArguments

  & winget @arguments
}

function Ensure-BuildTools {
  if ($SkipBuildTools) {
    return
  }

  Invoke-WingetInstall `
    -Id 'Microsoft.VisualStudio.2022.BuildTools' `
    -DisplayName 'Visual Studio 2022 Build Tools' `
    -AdditionalArguments @(
      '--override',
      '"--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"'
    )
}

function Ensure-VcRedist {
  if ($SkipVcRedist) {
    return
  }

  Invoke-WingetInstall -Id 'Microsoft.VCRedist.2015+.x64' -DisplayName 'Microsoft Visual C++ Redistributable 2015+ x64'
}

function Ensure-DefenderExclusion {
  if ($SkipDefenderExclusion) {
    return
  }

  if (-not (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) {
    Write-Warning 'Windows Defender cmdlets are unavailable. Skipping project exclusion.'
    return
  }

  $resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
  $preferences = Get-MpPreference
  if ($preferences.ExclusionPath -contains $resolvedProjectPath) {
    Write-Step "Microsoft Defender exclusion already exists for $resolvedProjectPath"
    return
  }

  if (-not (Test-IsAdministrator)) {
    Write-Step "Requesting Administrator privileges for Microsoft Defender exclusion: $resolvedProjectPath"
    $escapedPath = $resolvedProjectPath.Replace("'", "''")
    $command = "Add-MpPreference -ExclusionPath '$escapedPath'"
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', $command
    ) -Wait
    return
  }

  Write-Step "Adding Microsoft Defender exclusion for $resolvedProjectPath"
  Add-MpPreference -ExclusionPath $resolvedProjectPath
}

if (-not (Test-IsWindowsHost)) {
  throw 'This script only supports Windows.'
}

if (-not (Test-Path -LiteralPath $ProjectPath)) {
  throw "Project path does not exist: $ProjectPath"
}

Write-Step 'Preparing Windows prerequisites for Open Mercato'
Ensure-BuildTools
Ensure-VcRedist
Ensure-DefenderExclusion

Write-Host ''
Write-Host 'Windows development prerequisites are ready.' -ForegroundColor Green
