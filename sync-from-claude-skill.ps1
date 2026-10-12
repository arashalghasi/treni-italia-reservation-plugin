# Copies the Claude skill folder into this Codex plugin, so both run the same SKILL.md and scripts.
# Codex-only files (agents\openai.yaml, .codex-plugin\plugin.json) are not touched. Bump the version in
# plugins\trenitalia-commute\.codex-plugin\plugin.json afterwards, then: codex plugin add trenitalia-commute@trenitalia-commute-local
param([string]$Source = (Join-Path $PSScriptRoot '..\treni-italia-reservation\trenitalia-commute'))

$target = Join-Path $PSScriptRoot 'plugins\trenitalia-commute\skills\trenitalia-commute'
if (-not (Test-Path (Join-Path $Source 'SKILL.md'))) { Write-Host "No SKILL.md in $Source"; exit 1 }
robocopy $Source $target /E /XD agents /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "robocopy failed with exit code $LASTEXITCODE"; exit 1 }
Write-Host "Synced $Source -> $target"
