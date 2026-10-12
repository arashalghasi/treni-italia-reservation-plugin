# Saves the lefrecce.it username and password for commute.mjs, encrypted with Windows DPAPI:
# only this Windows user on this machine can read the file back. The password is never printed.
# Console prompts on purpose: the Windows credential dialog of Get-Credential prefills the Windows
# account (for example PC-NAME\Administrator) and saved that instead of the lefrecce.it username.
param([string]$Folder = (Join-Path $HOME '.trenitalia-commute'))

New-Item -ItemType Directory -Force $Folder | Out-Null
$file = Join-Path $Folder 'credential.xml'
$username = (Read-Host 'lefrecce.it username').Trim()
if (-not $username -or $username -match '\\') { Write-Host 'Not a lefrecce.it username, nothing saved.'; exit 1 }
$password = Read-Host 'lefrecce.it password (hidden)' -AsSecureString
if ($password.Length -eq 0) { Write-Host 'Empty password, nothing saved.'; exit 1 }
New-Object System.Management.Automation.PSCredential($username, $password) | Export-Clixml -LiteralPath $file
Write-Host 'Credential saved.'
