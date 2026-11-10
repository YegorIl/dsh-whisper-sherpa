<#
.SYNOPSIS
  Installs the dsh-whisper-local DSH plugin from a local tarball.

.DESCRIPTION
  Uses the stock DSH CLI (`plugin add`) with node and pnpm taken from the DSH
  runtime, so no global pnpm is required.
  Run it in a normal terminal (not inside the agent sandbox).

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Package D:\transfer\dsh-whisper-local-0.1.3.tgz -Profile desktop
  .\install.ps1 -DryRun
#>
param(
  [string]$Package = "",
  [string]$Profile = "desktop",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$dshHome = Join-Path $env:USERPROFILE '.dsh'
if (-not (Test-Path $dshHome)) { throw "DSH home not found: $dshHome" }

if ($Package -eq '') {
  $candidates = @(Get-ChildItem -Path $PSScriptRoot -Filter 'dsh-whisper-local-*.tgz' -ErrorAction SilentlyContinue)
  if ($candidates.Count -eq 0) { throw "No tarball next to this script. Pass -Package <path.tgz>" }
  $Package = $candidates[0].FullName
}
if (-not (Test-Path $Package)) { throw "File not found: $Package" }

$runtime = Get-ChildItem (Join-Path $dshHome 'dsh-runtimes') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $runtime) { throw "DSH runtime not found under $dshHome\dsh-runtimes" }
$deps = Join-Path $runtime.FullName 'dependencies'
$nodeExe = Join-Path $deps 'node\bin\node.exe'
$pnpmCjs = Join-Path $deps 'pnpm\bin\pnpm.cjs'
$cli = Join-Path $dshHome 'profiles\node_modules\@deepseek-ai\dsh\lib\bin.js'

foreach ($p in @($nodeExe, $pnpmCjs, $cli)) {
  if (-not (Test-Path $p)) { throw "DSH component not found: $p" }
}
$profileDir = Join-Path $dshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) { throw "Profile '$Profile' not found: $profileDir" }

# The CLI needs `pnpm` in PATH; the runtime only ships pnpm.cjs, so add a shim.
$shim = Join-Path $env:TEMP 'dsh-pnpm-shim'
New-Item -ItemType Directory -Force -Path $shim | Out-Null
$shimFile = Join-Path $shim 'pnpm.cmd'
Set-Content -Path $shimFile -Encoding ascii -Value "@echo off`r`n`"$nodeExe`" `"$pnpmCjs`" %*"
$env:PATH = "$shim;$(Split-Path $nodeExe);$env:PATH"

Write-Host ("DSH home: " + $dshHome)
Write-Host ("Profile:  " + $Profile + " (" + $profileDir + ")")
Write-Host ("Package:  " + $Package)
Write-Host ("Node:     " + $nodeExe)
Write-Host ("CLI:      " + $cli)

if ($DryRun) {
  Write-Host '--- DryRun: nothing executed ---'
  Write-Host ("& `"" + $nodeExe + "`" `"" + $cli + "`" plugin --profile " + $Profile + " add `"" + $Package + "`"")
  exit 0
}

& $nodeExe $cli plugin --profile $Profile add $Package
if ($LASTEXITCODE -ne 0) {
  throw ("CLI exited with code " + $LASTEXITCODE + ". Fallback: ask the DSH agent to install " + $Package + " via plugin_manager install_bundle.")
}

Write-Host ''
Write-Host 'Installed. Restart DSH (or reload the window), then:'
Write-Host '  Plugins -> Voice input -> Details -> provider "Whisper small (local)", language "Russian (ru)"'
Write-Host 'The ~610 MB model downloads during preparation unless it already sits in %USERPROFILE%\.dsh\speech-to-text\whisper-local\.'
