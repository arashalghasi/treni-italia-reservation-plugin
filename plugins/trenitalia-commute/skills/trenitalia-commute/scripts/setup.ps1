# First-run setup. All answers stay in the user's private ~/.trenitalia-commute folder.
# Sign-in happens later in the visible plugin browser; this script never asks for a password.
param(
  [string]$Folder,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $Folder) { $Folder = Join-Path $HOME '.trenitalia-commute' }
$configFile = Join-Path $Folder 'config.json'
if ((Test-Path -LiteralPath $configFile) -and -not $Force) {
  throw "Config already exists at $configFile. Use -Force only when you intend to replace it."
}

function Ask-Required([string]$Question) {
  do { $answer = (Read-Host $Question).Trim() } while (-not $answer)
  return $answer
}

function Ask-Time([string]$Question) {
  do { $answer = Ask-Required $Question } while ($answer -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  return $answer
}

function Ask-Number([string]$Question, [int]$Default) {
  do {
    $prompt = if ($Default -gt 0) { "$Question [$Default]" } else { $Question }
    $answer = (Read-Host $prompt).Trim()
    if (-not $answer -and $Default -gt 0) { return $Default }
    $number = 0
  } while (-not [int]::TryParse($answer, [ref]$number) -or $number -lt 1)
  return $number
}

function Ask-Leg([string]$Id, [string]$From, [string]$To) {
  Write-Host "`n$Id leg ($From to $To)"
  $service = Ask-Required 'Train service code (for example IC or FB)'
  $after = Ask-Time 'Earliest departure, HH:mm'
  do { $before = Ask-Time 'Latest departure, HH:mm' } while ($before -lt $after)
  $offerName = Ask-Required 'Exact zero-cost offer name shown on Le Frecce'
  $offerId = Ask-Number 'Offer ID shown in the fare selector' 0
  return [ordered]@{
    id = $Id; from = $From; to = $To; service = $service
    departAfter = $after; departBefore = $before
    offerName = $offerName; offerId = $offerId
  }
}

Write-Host 'Commute setup. Enter the details for the traveller and both daily trains.'
$firstName = Ask-Required 'Traveller first name'
$lastName = Ask-Required 'Traveller last name'
$accountLastName = (Read-Host 'Le Frecce account holder surname if different from traveller (optional)').Trim()
$card = Ask-Required 'Tutto Treno / Carta Tutto Treno card number'
$homeStation = Ask-Required 'Home station, as shown on Le Frecce'
$workStation = Ask-Required 'Work station, as shown on Le Frecce'
$outbound = Ask-Leg 'outbound' 'home' 'work'
$return = Ask-Leg 'return' 'work' 'home'
$workingDays = Ask-Number 'Number of working days to check ahead' 20
$weekdaysText = (Read-Host 'Travel weekdays as numbers 0=Sun, 1=Mon through 6=Sat, comma-separated [1,2,3,4,5]').Trim()
if (-not $weekdaysText) { $weekdaysText = '1,2,3,4,5' }
$weekdays = @()
foreach ($part in $weekdaysText.Split(',')) {
  $weekday = 0
  if (-not [int]::TryParse($part.Trim(), [ref]$weekday) -or $weekday -lt 0 -or $weekday -gt 6) { throw 'Weekdays must be numbers 0 through 6.' }
  if ($weekdays -contains $weekday) { throw 'Each weekday may appear only once.' }
  $weekdays += $weekday
}
$holidaysText = (Read-Host 'Additional no-travel dates, YYYY-MM-DD or MM-DD, comma-separated (optional)').Trim()
$holidays = @()
if ($holidaysText) {
  foreach ($part in $holidaysText.Split(',')) {
    $holiday = $part.Trim()
    if ($holiday -notmatch '^(\d{4}-)?\d{2}-\d{2}$') { throw 'No-travel dates must be YYYY-MM-DD or MM-DD.' }
    $holidays += $holiday
  }
}
$minutesBeforeDeparture = Ask-Number 'Minimum minutes before departure to permit booking' 15
$carriagesText = (Read-Host 'Preferred carriage numbers, comma-separated (optional)').Trim()
$carriages = @()
if ($carriagesText) {
  foreach ($part in $carriagesText.Split(',')) {
    $carriage = 0
    if (-not [int]::TryParse($part.Trim(), [ref]$carriage) -or $carriage -lt 1) { throw 'Carriage numbers must be positive integers.' }
    $carriages += $carriage
  }
}
$rulesText = (Read-Host 'Seat preference rules, semicolon-separated (optional)').Trim()
$rules = @()
if ($rulesText) { $rules = @($rulesText.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
$config = [ordered]@{
  traveller = [ordered]@{ firstName = $firstName; lastName = $lastName; tuttoTrenoCardNumber = $card }
  stations = [ordered]@{ home = $homeStation; work = $workStation }
  legs = @($outbound, $return)
  seats = [ordered]@{ carriages = $carriages; rules = $rules; knownGood = @() }
  window = [ordered]@{ workingDays = $workingDays; weekdays = $weekdays; extraHolidays = $holidays; minutesBeforeDeparture = $minutesBeforeDeparture }
}
if ($accountLastName) { $config['account'] = [ordered]@{ lastName = $accountLastName } }

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$json = $config | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($configFile, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Config saved at $configFile. Run 'node commute.mjs login' to verify the account."
