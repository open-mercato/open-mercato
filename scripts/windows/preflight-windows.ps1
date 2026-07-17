<#
  Open Mercato dev environment - Windows pre-flight check (READ-ONLY).

  Runs BEFORE start-windows-rancher.bat / start-windows.bat to tell you, in
  about a minute, whether a locked-down corporate machine will let the real
  launcher succeed - WITHOUT changing a single thing. It installs nothing,
  enables no Windows features, touches no registry keys, and downloads no
  files. Every check is a query.

  It reports the gates IT typically controls, ordered by how often they block:
    1. PowerShell execution policy + language mode (GPO / AppLocker / WDAC)
    2. Administrator / elevation availability
    3. WSL2 + VirtualMachinePlatform feature state and CPU virtualization
    4. Network egress: proxy config, TLS interception, per-host reachability
    5. Antivirus (Defender or third-party) that may throttle Docker/WSL I/O
    6. Existing tools (Git, container engine, WSL, Rancher Desktop)
    7. Clone location (OneDrive/redirected profile) + long-path support
    8. Dev-stack port availability (3000 / 3001 / 4000 / 4096)

  Exit code is always 0 - this is a diagnostic, not a gate.

  Usage (double-click check-windows.bat, or from any PowerShell):
    powershell -NoProfile -ExecutionPolicy Bypass -File preflight-windows.ps1
#>

[CmdletBinding()]
param(
    [string]$CloneRoot = $env:USERPROFILE,
    [string]$RepoName = "open-mercato"
)

# --- result plumbing (arrays + hashtables only, so it survives Constrained
# --- Language Mode where New-Object on arbitrary .NET types is blocked) ------
$script:Findings = @()
$script:AppPort = 3000
$script:McpPort = 3001
$script:SplashPort = 4000
$script:OpencodePort = 4096

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    Write-Host $Message -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Add-Finding {
    # Level: PASS | WARN | FAIL | INFO. Hard = $true marks a gate that, when it
    # FAILs, is likely to stop the real launcher outright (used in the verdict).
    param(
        [ValidateSet("PASS", "WARN", "FAIL", "INFO")][string]$Level,
        [string]$Area,
        [string]$Message,
        [switch]$Hard
    )
    $script:Findings += @{ Level = $Level; Area = $Area; Message = $Message; Hard = [bool]$Hard }
    $prefix = switch ($Level) {
        "PASS" { "[PASS]" }
        "WARN" { "[WARN]" }
        "FAIL" { "[FAIL]" }
        default { "[INFO]" }
    }
    $color = switch ($Level) {
        "PASS" { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        default { "Gray" }
    }
    Write-Host ("  {0,-6} {1,-14} {2}" -f $prefix, $Area, $Message) -ForegroundColor $color
}

# ---------------------------------------------------------------------------
# 1. PowerShell execution policy + language mode
# ---------------------------------------------------------------------------
$script:IsConstrained = $false
function Test-PowerShellHost {
    Write-Section "1. PowerShell host (execution policy + language mode)"

    $mode = $ExecutionContext.SessionState.LanguageMode
    if ("$mode" -eq "FullLanguage") {
        Add-Finding PASS "LanguageMode" "FullLanguage - the launcher can build the .NET objects it needs."
    } else {
        $script:IsConstrained = $true
        Add-Finding FAIL "LanguageMode" "$mode - WDAC/AppLocker restricts PowerShell. The launcher's TLS/cert and admin logic will throw here. Some checks below are skipped." -Hard
    }

    Add-Finding INFO "PSVersion" ("PowerShell {0}" -f $PSVersionTable.PSVersion.ToString())

    try {
        $policies = Get-ExecutionPolicy -List
        foreach ($entry in $policies) {
            if ($entry.ExecutionPolicy -ne "Undefined") {
                Add-Finding INFO "ExecPolicy" ("{0} = {1}" -f $entry.Scope, $entry.ExecutionPolicy)
            }
        }
        $effective = Get-ExecutionPolicy
        $gpoLocked = @($policies | Where-Object { $_.Scope -in @("MachinePolicy", "UserPolicy") -and $_.ExecutionPolicy -in @("AllSigned", "Restricted") })
        if ($gpoLocked.Count -gt 0) {
            Add-Finding FAIL "ExecPolicy" ("Group Policy ({0}) enforces '{1}', which overrides -ExecutionPolicy Bypass. The unsigned launcher may be blocked." -f $gpoLocked[0].Scope, $gpoLocked[0].ExecutionPolicy) -Hard
        } elseif ($effective -in @("AllSigned", "Restricted")) {
            Add-Finding WARN "ExecPolicy" ("Effective policy is '{0}'. The .bat passes -ExecutionPolicy Bypass, which normally wins unless GPO/WDAC forbids it." -f $effective)
        } else {
            Add-Finding PASS "ExecPolicy" ("Effective policy '{0}' allows the launcher to run." -f $effective)
        }
    } catch {
        Add-Finding WARN "ExecPolicy" "Could not read execution policy: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# 2. Administrator / elevation availability
# ---------------------------------------------------------------------------
function Test-Elevation {
    Write-Section "2. Administrator rights (needed once, only if WSL2 is missing)"
    $isAdmin = $null
    if (-not $script:IsConstrained) {
        try {
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
            $principal = New-Object Security.Principal.WindowsPrincipal($identity)
            $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        } catch { $isAdmin = $null }
    }
    if ($isAdmin -eq $true) {
        Add-Finding PASS "Elevation" "This session is already elevated (Administrator)."
    } elseif ($isAdmin -eq $false) {
        Add-Finding INFO "Elevation" "Running as a standard (non-elevated) user. That's fine IF WSL2 is already enabled (see section 3) - Rancher then installs per-user with no admin."
    } else {
        Add-Finding INFO "Elevation" "Elevation state unknown (Constrained Language Mode). Assume standard user."
    }
}

# ---------------------------------------------------------------------------
# 3. WSL2 + VirtualMachinePlatform + CPU virtualization  (the biggest gate)
# ---------------------------------------------------------------------------
function Test-Wsl {
    Write-Section "3. WSL2 / virtualization (the single most important gate)"

    $wslEnabled = $null
    $vmpEnabled = $null
    foreach ($feature in @(
        @{ Name = "Microsoft-Windows-Subsystem-Linux"; Label = "WSL" },
        @{ Name = "VirtualMachinePlatform"; Label = "VirtualMachinePlatform" }
    )) {
        try {
            $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature.Name -ErrorAction Stop).State
            if ($feature.Label -eq "WSL") { $wslEnabled = ($state -eq "Enabled") } else { $vmpEnabled = ($state -eq "Enabled") }
            if ($state -eq "Enabled") {
                Add-Finding PASS "Feature" ("{0} is Enabled." -f $feature.Label)
            } else {
                Add-Finding FAIL "Feature" ("{0} is '{1}'. Enabling it needs admin + a reboot; on locked machines this is the usual hard stop." -f $feature.Label, $state) -Hard
            }
        } catch {
            Add-Finding WARN "Feature" ("Could not query {0} (needs elevation to read on some builds): {1}" -f $feature.Label, $_.Exception.Message)
        }
    }

    # Functional signal: a working `wsl -l -v` proves WSL2 is truly usable, not
    # just feature-flagged. This is what really matters for per-user Rancher.
    if (Get-Command wsl -ErrorAction SilentlyContinue) {
        try {
            $wslList = (wsl.exe -l -v 2>&1 | Out-String)
            if ($LASTEXITCODE -eq 0 -and $wslList -match "\S") {
                Add-Finding PASS "WSL runtime" "wsl -l -v works - WSL2 is functional. Rancher Desktop can install per-user, no admin needed."
            } else {
                Add-Finding WARN "WSL runtime" "wsl.exe is present but reports no usable distro yet. `wsl --status` may show 'installation incomplete'."
            }
        } catch {
            Add-Finding WARN "WSL runtime" "wsl.exe present but errored on query: $($_.Exception.Message)"
        }
    } else {
        Add-Finding WARN "WSL runtime" "wsl.exe not found on PATH - WSL2 is probably not installed yet."
    }

    # CPU / firmware virtualization - VirtualMachinePlatform needs it, and IT
    # frequently disables it in BIOS or via VBS/Credential Guard policies.
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        if ($cs.HypervisorPresent -eq $true) {
            Add-Finding PASS "Virtualization" "A hypervisor is already running (HypervisorPresent=True) - virtualization works."
        } else {
            $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($cpu -and $cpu.VirtualizationFirmwareEnabled -eq $true) {
                Add-Finding PASS "Virtualization" "Enabled in firmware (no hypervisor running yet, which is normal)."
            } elseif ($cpu -and $cpu.VirtualizationFirmwareEnabled -eq $false) {
                Add-Finding FAIL "Virtualization" "Disabled in BIOS/firmware. WSL2 cannot run until IT enables VT-x/AMD-V (and it may be blocked by policy)." -Hard
            } else {
                Add-Finding WARN "Virtualization" "Could not determine firmware virtualization state; verify VT-x/AMD-V is enabled if WSL2 setup fails."
            }
        }
    } catch {
        Add-Finding WARN "Virtualization" "Could not query virtualization state: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# 4. Network egress: proxy config, TLS interception, per-host reachability
# ---------------------------------------------------------------------------
function Test-Network {
    Write-Section "4. Network egress (proxy, TLS interception, download hosts)"

    $proxyEnv = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } else { $env:HTTP_PROXY }
    if ($proxyEnv) {
        Add-Finding INFO "Proxy(env)" ("HTTPS_PROXY/HTTP_PROXY set: {0}" -f $proxyEnv)
    } else {
        Add-Finding INFO "Proxy(env)" "No HTTPS_PROXY set. If your proxy needs auth, set it before running the launcher: `$env:HTTPS_PROXY='http://user:pass@proxy:8080'."
    }
    try {
        $wininet = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
        if ($wininet.ProxyEnable -eq 1 -and $wininet.ProxyServer) {
            Add-Finding INFO "Proxy(system)" ("WinINET proxy is ON: {0}" -f $wininet.ProxyServer)
        }
        if ($wininet.AutoConfigURL) {
            Add-Finding INFO "Proxy(PAC)" ("Auto-config (PAC) URL in use: {0}. Raw downloads may need HTTPS_PROXY set explicitly." -f $wininet.AutoConfigURL)
        }
    } catch { }

    # Reachability via Invoke-WebRequest so the system/WinINET proxy is honored
    # (a raw TCP test would falsely fail on CONNECT-only proxies). We only read
    # headers; nothing is saved to disk.
    $targets = @(
        @{ Host = "raw.githubusercontent.com"; Url = "https://raw.githubusercontent.com/open-mercato/open-mercato/main/README.md"; Why = "launcher self-download" },
        @{ Host = "github.com"; Url = "https://github.com/open-mercato/open-mercato"; Why = "repo clone" },
        @{ Host = "api.github.com"; Url = "https://api.github.com"; Why = "installer version lookups" },
        @{ Host = "desktop.docker.com"; Url = "https://desktop.docker.com"; Why = "Docker Desktop download" },
        @{ Host = "wslstorestorage.blob.core.windows.net"; Url = "https://wslstorestorage.blob.core.windows.net"; Why = "WSL2 kernel download" }
    )
    foreach ($target in $targets) {
        try {
            $params = @{ Uri = $target.Url; UseBasicParsing = $true; TimeoutSec = 12; Method = "Head" }
            if ($env:HTTPS_PROXY) { $params.Proxy = $env:HTTPS_PROXY; $params.ProxyUseDefaultCredentials = $true }
            Invoke-WebRequest @params | Out-Null
            Add-Finding PASS "Reach" ("{0} reachable ({1})." -f $target.Host, $target.Why)
        } catch {
            $msg = "$($_.Exception.Message)"
            if ($msg -match "trust|certificate|SSL|TLS|verify|issuer|self.signed") {
                Add-Finding WARN "Reach" ("{0}: TLS/cert error - a TLS-intercepting proxy (Zscaler/Netskope) is likely. Image builds will need your corporate root CA in docker\certs\. ({1})" -f $target.Host, $target.Why)
            } elseif ($msg -match "407") {
                Add-Finding FAIL "Reach" ("{0}: proxy authentication required (407). Set HTTPS_PROXY with credentials. ({1})" -f $target.Host, $target.Why) -Hard
            } else {
                $shortMsg = ($msg -replace "\s+", " ").Trim()
                if ($shortMsg.Length -gt 80) { $shortMsg = $shortMsg.Substring(0, 80) }
                Add-Finding WARN "Reach" ("{0}: not reachable ({1}). Pre-seed installers into an 'installers' folder if this host stays blocked. [{2}]" -f $target.Host, $target.Why, $shortMsg)
            }
        }
    }
    Add-Finding INFO "Escape hatch" "If downloads stay blocked: drop official installers into an 'installers\' folder next to the .bat (or set OM_INSTALLERS_DIR) for an offline tool install - Docker images still need registry access, though."
}

# ---------------------------------------------------------------------------
# 5. Antivirus (Defender or third-party)
# ---------------------------------------------------------------------------
function Test-Antivirus {
    Write-Section "5. Antivirus (may throttle or quarantine Docker/WSL/node I/O)"
    $foundThirdParty = $false
    try {
        $products = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop
        foreach ($product in $products) {
            if ($product.displayName -and $product.displayName -notmatch "Windows Defender|Microsoft Defender") {
                $foundThirdParty = $true
                Add-Finding WARN "AV" ("Third-party AV/EDR active: '{0}'. CrowdStrike/SentinelOne/Carbon Black etc. can slow or block container & node_modules I/O; the launcher's Defender exclusion won't cover it. Ask IT to exclude the clone folder." -f $product.displayName)
            }
        }
    } catch { }
    if (-not $foundThirdParty) {
        try {
            $mp = Get-MpComputerStatus -ErrorAction Stop
            if ($mp.RealTimeProtectionEnabled) {
                Add-Finding INFO "AV" "Microsoft Defender real-time protection is on. The launcher adds a folder exclusion IF elevated; without admin it's skipped (just slower file scans, still works)."
            } else {
                Add-Finding PASS "AV" "Microsoft Defender real-time protection is off - no scan overhead."
            }
        } catch {
            Add-Finding INFO "AV" "Could not read Defender status; assume real-time scanning is on."
        }
    }
}

# ---------------------------------------------------------------------------
# 6. Existing tools
# ---------------------------------------------------------------------------
function Test-Tools {
    Write-Section "6. Existing tools"
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Add-Finding PASS "Git" ((git --version 2>&1 | Out-String).Trim())
    } else {
        Add-Finding INFO "Git" "Not installed - the launcher will download and install it (needs github.com reachable; see section 4)."
    }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Add-Finding PASS "Docker CLI" ((docker --version 2>&1 | Out-String).Trim())
    } else {
        $rdDocker = Join-Path $env:USERPROFILE ".rd\bin\docker.exe"
        if (Test-Path $rdDocker) {
            Add-Finding PASS "Docker CLI" "Rancher Desktop docker CLI found at ~\.rd\bin (not yet on PATH; the launcher adds it)."
        } else {
            Add-Finding INFO "Docker CLI" "No container CLI yet - the launcher installs Rancher Desktop (per-user if WSL2 is present)."
        }
    }
    $rancherExe = Join-Path $env:LOCALAPPDATA "Programs\Rancher Desktop\Rancher Desktop.exe"
    if (Test-Path $rancherExe) {
        Add-Finding PASS "Rancher" "Rancher Desktop is installed (per-user)."
    } else {
        Add-Finding INFO "Rancher" "Rancher Desktop not installed yet."
    }
}

# ---------------------------------------------------------------------------
# 7. Clone location + long-path support
# ---------------------------------------------------------------------------
function Test-CloneLocation {
    Write-Section "7. Clone location + long-path support"
    $target = Join-Path $CloneRoot $RepoName
    Add-Finding INFO "Clone path" ("Repo will clone to: {0}" -f $target)

    $oneDrive = $env:OneDrive
    if ($oneDrive -and $target.ToLower().StartsWith($oneDrive.ToLower())) {
        Add-Finding WARN "OneDrive" "The clone path is inside OneDrive. Sync + Docker bind mounts + node_modules cause lock conflicts and slow builds. Clone elsewhere: pass -CloneRoot C:\dev to the launcher."
    } elseif ($env:USERPROFILE -and $env:USERPROFILE -match "\\\\") {
        Add-Finding WARN "Profile" "Your user profile looks like a redirected/UNC path. Bind-mount performance will suffer; prefer a local disk path via -CloneRoot."
    } else {
        Add-Finding PASS "Clone path" "Not under OneDrive - good for Docker bind mounts and build I/O."
    }

    try {
        $longPaths = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -ErrorAction Stop).LongPathsEnabled
        if ($longPaths -eq 1) {
            Add-Finding PASS "LongPaths" "Win32 long paths are enabled - deep node_modules paths are safe."
        } else {
            Add-Finding WARN "LongPaths" "Long paths are OFF. Deep node_modules can exceed MAX_PATH (260). Keep the clone path short (e.g. C:\dev\open-mercato)."
        }
    } catch {
        Add-Finding WARN "LongPaths" "Could not read LongPathsEnabled. Keep the clone path short to be safe."
    }

    try {
        $drive = (Get-Item $CloneRoot -ErrorAction Stop).PSDrive
        if ($drive) {
            $free = [Math]::Round((Get-PSDrive $drive.Name).Free / 1GB, 1)
            if ($free -lt 15) {
                Add-Finding WARN "Disk" ("Only {0} GB free on {1}: - the stack (images + volumes) wants ~15-20 GB." -f $free, $drive.Name)
            } else {
                Add-Finding PASS "Disk" ("{0} GB free on {1}: - enough headroom." -f $free, $drive.Name)
            }
        }
    } catch { }
}

# ---------------------------------------------------------------------------
# 8. Dev-stack port availability
# ---------------------------------------------------------------------------
function Test-Ports {
    Write-Section "8. Dev-stack ports (defaults; overridable in .env)"
    $ports = @(
        @{ Port = $script:AppPort; Name = "app" },
        @{ Port = $script:McpPort; Name = "mcp" },
        @{ Port = $script:SplashPort; Name = "dev splash" },
        @{ Port = $script:OpencodePort; Name = "opencode" }
    )
    foreach ($entry in $ports) {
        try {
            $conn = Get-NetTCPConnection -State Listen -LocalPort $entry.Port -ErrorAction SilentlyContinue
            if ($conn) {
                $owner = ""
                try { $owner = (Get-Process -Id ($conn | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName } catch { }
                Add-Finding WARN "Port $($entry.Port)" ("In use by '{0}' ({1}). Change it in .env before starting, or free the port." -f $owner, $entry.Name)
            } else {
                Add-Finding PASS "Port $($entry.Port)" ("Free ({0})." -f $entry.Name)
            }
        } catch {
            Add-Finding INFO "Port $($entry.Port)" "Could not check (Get-NetTCPConnection unavailable)."
        }
    }
}

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
function Write-Verdict {
    Write-Section "Verdict"
    $fails = @($script:Findings | Where-Object { $_.Level -eq "FAIL" })
    $hardFails = @($fails | Where-Object { $_.Hard })
    $warns = @($script:Findings | Where-Object { $_.Level -eq "WARN" })

    if ($hardFails.Count -gt 0) {
        Write-Host "  LIKELY BLOCKED - resolve these hard gates before running the launcher:" -ForegroundColor Red
        foreach ($item in $hardFails) { Write-Host ("    - [{0}] {1}" -f $item.Area, $item.Message) -ForegroundColor Red }
    } elseif ($fails.Count -gt 0 -or $warns.Count -gt 0) {
        Write-Host "  SHOULD WORK, WITH CAVEATS - no hard blockers, but review these:" -ForegroundColor Yellow
    } else {
        Write-Host "  READY - no blockers detected. Run start-windows-rancher.bat." -ForegroundColor Green
    }

    if ($warns.Count -gt 0) {
        Write-Host ""
        Write-Host "  Warnings to review:" -ForegroundColor Yellow
        foreach ($item in $warns) { Write-Host ("    - [{0}] {1}" -f $item.Area, $item.Message) -ForegroundColor Yellow }
    }

    Write-Host ""
    Write-Host ("  Summary: {0} pass, {1} warn, {2} fail." -f `
        @($script:Findings | Where-Object { $_.Level -eq "PASS" }).Count, `
        $warns.Count, $fails.Count) -ForegroundColor Cyan
    Write-Host "  This check changed nothing on your machine." -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  The three gates that decide everything:" -ForegroundColor Cyan
    Write-Host "    1. PowerShell in FullLanguage + able to run the unsigned launcher (section 1)." -ForegroundColor Gray
    Write-Host "    2. WSL2 already enabled -> no admin needed at all (section 3)." -ForegroundColor Gray
    Write-Host "    3. GitHub + Docker hosts reachable through your proxy (section 4)." -ForegroundColor Gray
}

Write-Host ""
Write-Host "Open Mercato - Windows pre-flight (read-only; nothing will be installed or changed)" -ForegroundColor Cyan

Test-PowerShellHost
Test-Elevation
Test-Wsl
Test-Network
Test-Antivirus
Test-Tools
Test-CloneLocation
Test-Ports
Write-Verdict

exit 0
