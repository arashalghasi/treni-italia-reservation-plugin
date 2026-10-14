# trenitalia-commute

For a colleague who commutes by train on an abbonamento / Carta Tutto Treno and wants Claude or Codex to book
the free daily seat reservations on lefrecce.it. See the [repository README](../../../../README.md) for
Claude Code, Claude Desktop and Codex Desktop installation commands.

The skill holds the procedure; your personal data lives in one config file in your home folder. The folder you
received contains nothing personal, so you can pass it on as it is.

## What is in the folder

| File | Role |
|---|---|
| `SKILL.md` | the procedure Claude follows: rules, account check, plan, booking flow, traps, report |
| `config.example.json` | template of the personal config |
| `scripts/commute.mjs` | helper script: `doctor`, `status` (read-only plan), `login`, `book`, `record` |
| `scripts/package.json` | pins `playwright-core` (drives installed Chrome or Edge; no browser download) |
| `scripts/setup.ps1` | first-run questionnaire for the private commute config |

Personal state, all in `~/.trenitalia-commute/` (Windows: `%USERPROFILE%\.trenitalia-commute\`):
`config.json`, `browser-profile/` (the script's own signed-in Chrome profile),
`runs/` (one JSON per `status` run, booking log), `recordings/`.

## Setup (once)

1. Node 22 or newer (`node -v`) and Google Chrome or Microsoft Edge.
2. In the **installed plugin's** script folder, install the dependency:

   ```powershell
   Set-Location -LiteralPath "<installed skill folder>\scripts"
   npm ci
   ```

3. Ask the skill to set up your commute. It asks for the traveller, account holder surname if different, card,
   stations, both train services and time
   windows, exact free fare names and IDs, travel days, and seat preferences, then writes the private config. For
   Sign in yourself later in the visible plugin browser. Alternatively, run the complete questionnaire in your
   own PowerShell terminal. The config is saved under `%USERPROFILE%\.trenitalia-commute`, outside the plugin and
   Git repository; the questionnaire does not ask for a password.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill folder>\scripts\setup.ps1"
   ```

   To replace an existing config intentionally, pass `-Force` to `setup.ps1`.

4. Run `doctor` to check the local runtime, then run `login` and sign in yourself in the visible plugin browser.
   The browser uses its own profile and keeps the session for later runs.
   `doctor.runtimeReady` does not test whether Le Frecce accepts authentication from this network.

   ```powershell
   node "<skill folder>\scripts\commute.mjs" doctor
   node <skill folder>\scripts\commute.mjs login
   ```

   On macOS/Linux, ask the skill to write the private config, then run `login` locally with a graphical session.
   The ordinary Chrome profile and plugin profile are separate. `status` and `book` also open the visible plugin
   browser when sign-in is needed, then continue after verifying the account and reading its trips.
   An older `credential.xml` is ignored by this version; remove it locally if you no longer need it.

## Commands

```powershell
node commute.mjs doctor                 # check workstation setup; visits no website
node commute.mjs status                 # next 20 working days
node commute.mjs status --days=5        # shorter window
node commute.mjs status --from=YYYY-MM-DD
node commute.mjs status --headless      # reuse an existing verified session only
node commute.mjs book --confirm         # book every day the account still misses (both legs), €0,00 only
node commute.mjs book --count=2 --confirm   # only the next two such days
node commute.mjs book --from=2030-06-01 --until=2030-06-10 --confirm  # only missing days in this range
node commute.mjs book --until=2030-06-30 --confirm  # never book after this date
node commute.mjs book --on=2030-06-12 --leg=outbound --count=1 --confirm  # one specified missing leg
node commute.mjs book --count=1         # dry run: stops on the payment page, books nothing
node commute.mjs login                  # wait for you to sign in in the visible plugin browser
node commute.mjs record                 # record the site's API calls while you book one day by hand
```

`status` and `book` print one JSON line on stdout (`status` also a table on stderr); exit code `0` ok, `1` error,
`2` not signed in. `book` picks the days itself from the account (it never asks), writes
`runs/<date>_bookings.md`, and proves every booking from the trip list (PNR). A dry-run cart keeps its seats
for about 10 minutes, so a real run right after it may get other seats.

The script stops if any trip-list page fails, an active trip record cannot be parsed, a matching trip has no PNR,
or the passenger fields do not hold the configured values. It searches the requested window once, then rechecks
each candidate day's account state immediately before booking. A `--from`/`--until` range may span at most 366
calendar days.

The script records only the authentication request's HTTP status, MIME type and error category. An HTTP 403 HTML
Access Denied response is reported as `site-access-blocked`, even if the login page says “Incorrect username or
password”; the credentials were not verified. An explicit structured API error is required before the plugin calls
them rejected. A cloud network can be blocked while public search works. Run on your own computer/network and use
`login` in the plugin's visible, dedicated profile. Manual login needs `DISPLAY` or `WAYLAND_DISPLAY` on Linux;
`--headless` runs reuse a valid session or stop. Do not rotate IPs,
use proxies, bypass CAPTCHA, or copy cookies to get around a block.

```
YYYY-MM-DD Tue  outbound  to-book                <train> <time>
YYYY-MM-DD Tue  return    booked                 PNR XXXXXX (<time>)
YYYY-MM-DD Fri  return    no-matching-train      <other trains in the window>
```

## Using it with Claude or Codex

- **Claude Code / Claude Desktop Code / Codex Desktop:** install the plugin as shown in the
  [repository README](../../../../README.md), then ask *"Set up my commute"* on first use or name the dates
  you want to reserve later. The skill checks the account before booking and reports the booked PNRs.
- **claude.ai skills:** zip the folder without `scripts/node_modules` and upload it. In a sandbox without Node
  and Chrome the script cannot run; Claude then reads the account in the browser (`SKILL.md` §2.2).

## Sharing

Zip the folder without `scripts/node_modules`, `.git`, or local state (`config.json`, `credential.xml`,
`browser-profile/`, `runs/`, `recordings/`). Review the archive for your name, email, card number, route,
travel dates and other identifying details before sending it. For example, search the source folder for
your own identifiers:

```powershell
Get-ChildItem "<skill folder>" -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  Select-String -Pattern "<your surname>","<your email>","<your card number>","<your route>"
```

No matches for these values do not rule out other identifying details; review the file list too.

## What is verified, and what is not yet

The initial local validation covered these flows:

| Part | State |
|---|---|
| train search (`ticket/solutions`), working days and holidays | verified against the site |
| trip list (`travel/solutions`) | verified against the "My trips" page |
| signed-in check | verified: token + surname in header + trip call (signed out the trip call answers 200 with an empty list) |
| manual sign-in in the plugin browser | verified session, readable account trips, no password handled by the script |
| `book`, dry run | verified that the cart held both free offers at the payment page |
| `book --confirm` | verified against PNRs in the trip list; the script waits for delayed trip entries, switches a first-class return panel to second class, and retries a conditions box while extras load |
| no duplicates | verified against distinct day and leg slots in the account |
| `record` | not run (not needed: `book` drives the site's own pages) |

If the trip list arrives but cannot be parsed, `status` writes a masked sample to `runs/<date>_trips-sample.json`;
review it for remaining personal details before sharing it. When `book` stops, its JSON has `step`, `error` and a
screenshot path in `evidence`.

## Rules the skill never breaks

Total not €0.00: stop. Never re-book a leg that has a PNR. Never substitute another train type. Never handle the
password. Ask before accepting the conditions of carriage, unless you authorised the whole batch.
