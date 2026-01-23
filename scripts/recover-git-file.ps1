param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$RelPath,
  [string]$OutPath
)

$ErrorActionPreference = 'Stop'

$gitDir = Join-Path $RepoRoot '.git'
$packDir = Join-Path $gitDir 'objects\pack'
$idxPaths = (Get-ChildItem -LiteralPath $packDir -Filter '*.idx').FullName

function Read-BEUInt32([byte[]]$bytes, [int]$offset) {
  return [uint32](($bytes[$offset] -shl 24) -bor ($bytes[$offset + 1] -shl 16) -bor ($bytes[$offset + 2] -shl 8) -bor $bytes[$offset + 3])
}

function Read-BEUInt64([byte[]]$bytes, [int]$offset) {
  $hi = Read-BEUInt32 $bytes $offset
  $lo = Read-BEUInt32 $bytes ($offset + 4)
  return ([uint64]$hi -shl 32) -bor [uint64]$lo
}

function BytesToHex([byte[]]$bytes) {
  return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function HexToBytes([string]$hex) {
  $hex = $hex.Trim().ToLowerInvariant()
  if ($hex.Length -ne 40) { throw "Expected 40-hex hash" }
  $b = New-Object byte[] 20
  for ($i = 0; $i -lt 20; $i++) {
    $b[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
  }
  return $b
}

function Compare-ByteArrays([byte[]]$a, [byte[]]$b) {
  for ($i = 0; $i -lt $a.Length; $i++) {
    if ($a[$i] -lt $b[$i]) { return -1 }
    if ($a[$i] -gt $b[$i]) { return 1 }
  }
  return 0
}

function Find-ObjectInIdx {
  param([string]$IdxPath, [byte[]]$TargetHash)

  $bytes = [IO.File]::ReadAllBytes($IdxPath)
  if (!($bytes[0] -eq 0xff -and $bytes[1] -eq 0x74 -and $bytes[2] -eq 0x4f -and $bytes[3] -eq 0x63)) {
    throw "Unsupported idx: $IdxPath"
  }
  $version = Read-BEUInt32 $bytes 4
  if ($version -ne 2) { throw "Unsupported idx version: $version" }

  $fanoutOffset = 8
  $n = [int](Read-BEUInt32 $bytes ($fanoutOffset + 255 * 4))
  $hashesOffset = $fanoutOffset + 256 * 4
  $crcsOffset = $hashesOffset + $n * 20
  $offsetsOffset = $crcsOffset + $n * 4

  $lo = 0
  $hi = $n - 1
  while ($lo -le $hi) {
    $mid = [int](($lo + $hi) / 2)
    $midOff = $hashesOffset + $mid * 20
    $midHash = $bytes[$midOff..($midOff + 19)]
    $cmp = Compare-ByteArrays $midHash $TargetHash

    if ($cmp -eq 0) {
      $off = Read-BEUInt32 $bytes ($offsetsOffset + $mid * 4)
      if (($off -band 0x80000000) -eq 0) {
        return [pscustomobject]@{ offset = [uint64]$off }
      }
      $largeIndex = $off -band 0x7fffffff
      $largeOffsetsOffset = $offsetsOffset + $n * 4
      $largeOff = Read-BEUInt64 $bytes ($largeOffsetsOffset + $largeIndex * 8)
      return [pscustomobject]@{ offset = $largeOff }
    }
    elseif ($cmp -lt 0) { $hi = $mid - 1 }
    else { $lo = $mid + 1 }
  }

  return $null
}

function Find-ObjectInPacks {
  param([string]$Hash)
  $hBytes = HexToBytes $Hash
  foreach ($idxPath in $idxPaths) {
    $found = Find-ObjectInIdx -IdxPath $idxPath -TargetHash $hBytes
    if ($null -ne $found) {
      $packPath = $idxPath -replace '\.idx$', '.pack'
      return [pscustomobject]@{ pack = $packPath; offset = $found.offset }
    }
  }
  throw "Object not found in any idx: $Hash"
}

function Read-GitVarInt([byte[]]$bytes, [ref]$i) {
  $result = [uint64]0
  $shift = 0
  while ($true) {
    if ($i.Value -ge $bytes.Length) { throw 'EOF in varint' }
    $b = $bytes[$i.Value]
    $i.Value++
    $result = $result -bor ([uint64]($b -band 0x7f) -shl $shift)
    if (($b -band 0x80) -eq 0) { break }
    $shift += 7
  }
  return $result
}

function Apply-GitDelta([byte[]]$BaseBytes, [byte[]]$DeltaBytes) {
  $i = 0
  [void](Read-GitVarInt -bytes $DeltaBytes -i ([ref]$i)) # base size (sanity only)
  $resultSize = Read-GitVarInt -bytes $DeltaBytes -i ([ref]$i)

  $out = New-Object byte[] ([int]$resultSize)
  $outPos = 0

  while ($i -lt $DeltaBytes.Length) {
    $op = $DeltaBytes[$i]
    $i++
    if ($op -eq 0) { throw 'Invalid delta opcode 0' }

    if (($op -band 0x80) -ne 0) {
      $cpOff = 0
      $cpSize = 0
      if (($op -band 0x01) -ne 0) { $cpOff = $cpOff -bor $DeltaBytes[$i]; $i++ }
      if (($op -band 0x02) -ne 0) { $cpOff = $cpOff -bor ($DeltaBytes[$i] -shl 8); $i++ }
      if (($op -band 0x04) -ne 0) { $cpOff = $cpOff -bor ($DeltaBytes[$i] -shl 16); $i++ }
      if (($op -band 0x08) -ne 0) { $cpOff = $cpOff -bor ($DeltaBytes[$i] -shl 24); $i++ }

      if (($op -band 0x10) -ne 0) { $cpSize = $cpSize -bor $DeltaBytes[$i]; $i++ }
      if (($op -band 0x20) -ne 0) { $cpSize = $cpSize -bor ($DeltaBytes[$i] -shl 8); $i++ }
      if (($op -band 0x40) -ne 0) { $cpSize = $cpSize -bor ($DeltaBytes[$i] -shl 16); $i++ }
      if ($cpSize -eq 0) { $cpSize = 0x10000 }

      [Array]::Copy($BaseBytes, $cpOff, $out, $outPos, $cpSize)
      $outPos += $cpSize
    }
    else {
      $litSize = $op
      [Array]::Copy($DeltaBytes, $i, $out, $outPos, $litSize)
      $i += $litSize
      $outPos += $litSize
    }
  }

  return $out
}

$OBJ_COMMIT = 1
$OBJ_TREE = 2
$OBJ_BLOB = 3
$OBJ_OFS_DELTA = 6
$OBJ_REF_DELTA = 7

function Read-PackObjectAt {
  param([string]$PackPath, [uint64]$Offset)

  $fs = [IO.File]::OpenRead($PackPath)
  try {
    $fs.Position = [int64]$Offset

    $b0 = $fs.ReadByte()
    if ($b0 -lt 0) { throw 'EOF reading header' }

    $type = ($b0 -shr 4) -band 0x07
    $size = [uint64]($b0 -band 0x0f)
    $shift = 4
    while (($b0 -band 0x80) -ne 0) {
      $b0 = $fs.ReadByte()
      if ($b0 -lt 0) { throw 'EOF reading size cont' }
      $size = $size -bor ([uint64]($b0 -band 0x7f) -shl $shift)
      $shift += 7
    }

    if ($type -eq $OBJ_OFS_DELTA) {
      $c = $fs.ReadByte(); if ($c -lt 0) { throw 'EOF reading ofs-delta base' }
      $baseOff = [uint64]($c -band 0x7f)
      while (($c -band 0x80) -ne 0) {
        $c = $fs.ReadByte(); if ($c -lt 0) { throw 'EOF reading ofs-delta base cont' }
        $baseOff = (($baseOff + 1) -shl 7) -bor [uint64]($c -band 0x7f)
      }
      $baseOffset = [uint64]$Offset - $baseOff

      $ds = New-Object System.IO.Compression.DeflateStream($fs, [System.IO.Compression.CompressionMode]::Decompress, $true)
      try {
        $ms = New-Object IO.MemoryStream
        $ds.CopyTo($ms)
        $delta = $ms.ToArray()
      }
      finally { $ds.Dispose() }

      $baseObj = Read-PackObjectAt -PackPath $PackPath -Offset $baseOffset
      $result = Apply-GitDelta -BaseBytes $baseObj.data -DeltaBytes $delta
      return [pscustomobject]@{ type = $baseObj.type; data = $result }
    }

    if ($type -eq $OBJ_REF_DELTA) {
      $baseHashBytes = New-Object byte[] 20
      $read = $fs.Read($baseHashBytes, 0, 20)
      if ($read -ne 20) { throw 'EOF reading ref-delta base hash' }
      $baseHash = BytesToHex $baseHashBytes

      $ds = New-Object System.IO.Compression.DeflateStream($fs, [System.IO.Compression.CompressionMode]::Decompress, $true)
      try {
        $ms = New-Object IO.MemoryStream
        $ds.CopyTo($ms)
        $delta = $ms.ToArray()
      }
      finally { $ds.Dispose() }

      $baseLoc = Find-ObjectInPacks -Hash $baseHash
      $baseObj = Read-PackObjectAt -PackPath $baseLoc.pack -Offset $baseLoc.offset
      $result = Apply-GitDelta -BaseBytes $baseObj.data -DeltaBytes $delta
      return [pscustomobject]@{ type = $baseObj.type; data = $result }
    }

    $ds2 = New-Object System.IO.Compression.DeflateStream($fs, [System.IO.Compression.CompressionMode]::Decompress, $true)
    try {
      $ms2 = New-Object IO.MemoryStream
      $ds2.CopyTo($ms2)
      $data = $ms2.ToArray()
    }
    finally { $ds2.Dispose() }

    return [pscustomobject]@{ type = $type; data = $data }
  }
  finally {
    $fs.Dispose()
  }
}

function Parse-TreeEntries([byte[]]$treeBytes) {
  $entries = @()
  $i = 0
  while ($i -lt $treeBytes.Length) {
    $space = [Array]::IndexOf($treeBytes, [byte][char]' ', $i)
    if ($space -lt 0) { break }
    $mode = [Text.Encoding]::ASCII.GetString($treeBytes, $i, $space - $i)
    $i = $space + 1
    $nul = [Array]::IndexOf($treeBytes, [byte]0, $i)
    $name = [Text.Encoding]::UTF8.GetString($treeBytes, $i, $nul - $i)
    $i = $nul + 1
    $hash = BytesToHex $treeBytes[$i..($i + 19)]
    $i += 20
    $entries += [pscustomobject]@{ mode = $mode; name = $name; hash = $hash }
  }
  return $entries
}

function Get-HeadCommitHash {
  $head = (Get-Content -LiteralPath (Join-Path $gitDir 'HEAD') -Encoding ascii).Trim()
  if ($head -match '^ref:\s+(.+)$') {
    $ref = $Matches[1].Trim()
    $refFile = Join-Path $gitDir $ref
    if (Test-Path -LiteralPath $refFile) {
      return (Get-Content -LiteralPath $refFile -Encoding ascii).Trim()
    }
    $packed = Join-Path $gitDir 'packed-refs'
    foreach ($line in (Get-Content -LiteralPath $packed -Encoding ascii)) {
      if ($line -match '^[0-9a-f]{40}\s+' -and $line -match [regex]::Escape($ref) + '$') {
        return $line.Substring(0, 40)
      }
    }
    throw "Unable to resolve ref: $ref"
  }
  return $head
}

function Read-ObjectByHash([string]$hash) {
  $loc = Find-ObjectInPacks -Hash $hash
  return Read-PackObjectAt -PackPath $loc.pack -Offset $loc.offset
}

function Resolve-BlobHashForPath([string]$commitHash, [string]$path) {
  $commit = Read-ObjectByHash $commitHash
  if ($commit.type -ne $OBJ_COMMIT) { throw 'Expected commit object' }
  $commitText = [Text.Encoding]::UTF8.GetString($commit.data)
  $treeLine = ($commitText -split "`n" | Where-Object { $_ -match '^tree ' } | Select-Object -First 1)
  $treeHash = ($treeLine -split ' ')[1].Trim()

  $parts = $path -split '/' | Where-Object { $_ }
  $cur = $treeHash
  foreach ($p in $parts) {
    $tree = Read-ObjectByHash $cur
    if ($tree.type -ne $OBJ_TREE) { throw "Expected tree at segment: $p" }
    $entries = Parse-TreeEntries $tree.data
    $m = $entries | Where-Object { $_.name -eq $p } | Select-Object -First 1
    if (-not $m) { throw "Path segment not found: $p" }
    $cur = $m.hash
  }
  return $cur
}

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  $OutPath = Join-Path $RepoRoot ($RelPath -replace '/', '\\')
}

$commitHash = Get-HeadCommitHash
$blobHash = Resolve-BlobHashForPath -commitHash $commitHash -path $RelPath
$blob = Read-ObjectByHash $blobHash
if ($blob.type -ne $OBJ_BLOB) { throw "Expected blob, got type $($blob.type)" }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
[IO.File]::WriteAllBytes($OutPath, $blob.data)

Write-Output "OK: restored $RelPath to $OutPath"
