# Clean all generated files and directories on Windows
# - .mercato folder in Next.js apps
# - generated/ folders in packages
# - .turbo cache folders
# - .next build folders
# - dist build folders

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Write-Info($msg) { Write-Host "   [i]  $msg" -ForegroundColor Gray }
function Write-Ok($msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   [!]  $msg" -ForegroundColor Yellow }

function Test-IsCleanablePath($path) {
    return $path -notmatch "node_modules" -and
        $path -notmatch "__fixtures__"
}

function Test-IsUnderProjectRoot($path) {
    $FullPath = [System.IO.Path]::GetFullPath($path)
    $RootPath = [System.IO.Path]::GetFullPath($ProjectRoot)
    $RootPrefix = $RootPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

    return $FullPath.Equals($RootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $FullPath.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Remove-Dir($path) {
    if (-not (Test-Path -LiteralPath $path)) {
        return
    }

    $ResolvedPath = (Resolve-Path -LiteralPath $path).Path
    if (-not (Test-IsUnderProjectRoot $ResolvedPath)) {
        Write-Warn "Skipping path outside project root: $ResolvedPath"
        return
    }

    Write-Info "Removing: $ResolvedPath"
    try {
        Remove-Item -LiteralPath $ResolvedPath -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warn "Failed to remove: $ResolvedPath"
        Write-Warn $_.Exception.Message
    }
}

Set-Location $ProjectRoot

Write-Host "Cleaning generated files..."

$dirs = @()
$dirs += Get-ChildItem $ProjectRoot -Recurse -Directory -Filter ".mercato" -ErrorAction SilentlyContinue | Where-Object { Test-IsCleanablePath $_.FullName }
$dirs += Get-ChildItem $ProjectRoot -Recurse -Directory -Filter "generated" -ErrorAction SilentlyContinue | Where-Object { Test-IsCleanablePath $_.FullName }
$dirs += Get-ChildItem $ProjectRoot -Recurse -Directory -Filter ".turbo" -ErrorAction SilentlyContinue | Where-Object { Test-IsCleanablePath $_.FullName }
$dirs += Get-ChildItem $ProjectRoot -Recurse -Directory -Filter ".next" -ErrorAction SilentlyContinue | Where-Object { Test-IsCleanablePath $_.FullName }
$dirs += Get-ChildItem $ProjectRoot -Recurse -Directory -Filter "dist" -ErrorAction SilentlyContinue | Where-Object { Test-IsCleanablePath $_.FullName }

foreach ($dir in $dirs) {
    Remove-Dir $dir.FullName
}

Write-Ok "Done! Cleaned: .mercato, generated/, .turbo, .next, dist/"
