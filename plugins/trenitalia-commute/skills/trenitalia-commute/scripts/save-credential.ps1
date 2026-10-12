# Saves the lefrecce.it username and password for commute.mjs, encrypted with Windows DPAPI:
# only this Windows user on this machine can read the file back. The password is never printed.
# Console prompts on purpose: the Windows credential dialog of Get-Credential prefills the Windows
# account (for example PC-NAME\Administrator) and saved that instead of the lefrecce.it username.
param([string]$Folder)

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  throw 'This encrypted credential helper only supports Windows. Use login --manual on macOS or Linux.'
}
if (-not $Folder) { $Folder = Join-Path $env:USERPROFILE '.trenitalia-commute' }

New-Item -ItemType Directory -Force $Folder | Out-Null
$file = Join-Path $Folder 'credential.xml'
$username = (Read-Host 'lefrecce.it username').Trim()
if (-not $username -or $username -match '\\') { throw 'Not a lefrecce.it username, nothing saved.' }
$password = Read-Host 'lefrecce.it password (hidden)' -AsSecureString
if ($password.Length -eq 0) { throw 'Empty password, nothing saved.' }
New-Object System.Management.Automation.PSCredential($username, $password) | Export-Clixml -LiteralPath $file
Write-Host "Credential saved at $file."
