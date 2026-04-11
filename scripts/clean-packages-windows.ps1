# Clean all node_modules, dist, and build artifacts from the entire monorepo on Windows

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Write-Info($msg) { Write-Host "   [i]  $msg" -ForegroundColor Gray }
function Write-Ok($msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   [!]  $msg" -ForegroundColor Yellow }

function Test-IsCleanablePath($path) {
    return $path -notmatch "node_modules" -and
        $path -notmatch "__fixtures__"
}

function Stop-DevProcesses() {
    $EscapedProjectRoot = [regex]::Escape($ProjectRoot)
    $ProcessNames = @("esbuild.exe", "turbo.exe", "turbo")

    $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $ProcessNames -contains $_.Name -and
            $_.CommandLine -match $EscapedProjectRoot
        }

    if (-not $Processes) {
        Write-Info "No repo-scoped dev processes found"
        return
    }

    foreach ($Process in $Processes) {
        Write-Info "Stopping $($Process.Name) (PID $($Process.ProcessId))"
        Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    Write-Ok "Dev processes stopped"
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

function Remove-File($path) {
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
        Remove-Item -LiteralPath $ResolvedPath -Force -ErrorAction Stop
    } catch {
        Write-Warn "Failed to remove: $ResolvedPath"
        Write-Warn $_.Exception.Message
    }
}

Set-Location $ProjectRoot

Write-Host "Cleaning node_modules, dist, and build artifacts..."

Stop-DevProcesses

$nodeModulesDirs = Get-ChildItem $ProjectRoot -Recurse -Directory -Filter "node_modules" -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending

foreach ($dir in $nodeModulesDirs) {
    Remove-Dir $dir.FullName
}

$distDirs = Get-ChildItem $ProjectRoot -Recurse -Directory -Filter "dist" -ErrorAction SilentlyContinue |
    Where-Object { Test-IsCleanablePath $_.FullName }

foreach ($dir in $distDirs) {
    Remove-Dir $dir.FullName
}

$tsBuildInfoFiles = Get-ChildItem $ProjectRoot -Recurse -File -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
    Where-Object { Test-IsCleanablePath $_.FullName }

foreach ($file in $tsBuildInfoFiles) {
    Remove-File $file.FullName
}

Remove-Dir (Join-Path $ProjectRoot ".yarn\cache")
Remove-File (Join-Path $ProjectRoot ".yarn\install-state.gz")

Write-Ok "Done! All node_modules, dist, and .tsbuildinfo files removed."
Write-Host "Run 'yarn install' to reinstall dependencies."
