# trenitalia-commute

For a colleague who commutes by train on an abbonamento / Carta Tutto Treno and wants Claude to book the free
daily seat reservations on lefrecce.it.

The skill holds the procedure; your personal data lives in one config file in your home folder. The folder you
received contains nothing personal, so you can pass it on as it is.

## What is in the folder

| File | Role |
|---|---|
| `SKILL.md` | the procedure Claude follows: rules, account check, plan, booking flow, traps, report |
| `config.example.json` | template of the personal config |
| `scripts/commute.mjs` | helper script: `status` (read-only plan), `login`, `record` |
| `scripts/package.json` | declares `playwright-core` (drives the Chrome already installed; no browser download) |
| `scripts/save-credential.ps1` | saves the lefrecce.it username and password encrypted (Windows DPAPI) for automatic sign-in |
| `scripts/setup.ps1` | first-run questionnaire for personal config and encrypted sign-in credential |

Personal state, all in `~/.trenitalia-commute/` (Windows: `%USERPROFILE%\.trenitalia-commute\`):
`config.json`, `credential.xml` (optional), `browser-profile/` (the script's own signed-in Chrome profile),
`runs/` (one JSON per `status` run, booking log), `recordings/`.

## Setup (once)

1. Node 18 or newer (`node -v`) and Google Chrome.
2. Install the script dependency:

   ```powershell
   cd <skill folder>\scripts
   npm install
   ```

3. Run first-time setup in a local interactive PowerShell terminal. It asks for the traveller, card, stations,
   both train services and time windows, the exact free fare names and IDs, preferred carriages, and the
   Le Frecce username and password. The password prompt is hidden. Config and the Windows-encrypted credential
   are saved under `%USERPROFILE%\.trenitalia-commute`, outside the plugin and Git repository.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill folder>\scripts\setup.ps1"
   ```

   If you already have a config and only need to replace the saved sign-in, run `save-credential.ps1` instead.
   To replace an existing config intentionally, pass `-Force` to `setup.ps1`.

4. Verify sign-in. A Chrome window opens on the script's own profile; the session is kept for later runs.

   ```powershell
   node <skill folder>\scripts\commute.mjs login
   ```

   Outside Windows: copy `config.example.json` to `~/.trenitalia-commute/config.json`, replace every placeholder,
   and set `TRENITALIA_USERNAME` and `TRENITALIA_PASSWORD` in the run environment. The password is never written
   into the config, the skill, the output or the logs.

## Commands

```powershell
node commute.mjs status                 # next 20 working days
node commute.mjs status --days=5        # shorter window
node commute.mjs status --from=YYYY-MM-DD
node commute.mjs status --visible       # with a Chrome window, to watch
node commute.mjs book --confirm         # book every day the account still misses (both legs), €0,00 only
node commute.mjs book --count=2 --confirm   # only the next two such days
node commute.mjs book --until=2030-06-30 --confirm  # never book after this date
node commute.mjs book --on=2030-06-12 --leg=outbound --count=1 --confirm  # one specified missing leg
node commute.mjs book --count=1         # dry run: stops on the payment page, books nothing
node commute.mjs login                  # sign in from the saved credential (--manual: wait for you)
node commute.mjs record                 # record the site's API calls while you book one day by hand
```

`status` and `book` print one JSON line on stdout (`status` also a table on stderr); exit code `0` ok, `1` error,
`2` not signed in. `book` picks the days itself from the account (it never asks), writes
`runs/<date>_bookings.md`, and proves every booking from the trip list (PNR). A dry-run cart keeps its seats
for about 10 minutes, so a real run right after it may get other seats.

```
YYYY-MM-DD Tue  outbound  to-book                <train> <time>
YYYY-MM-DD Tue  return    booked                 PNR XXXXXX (<time>)
YYYY-MM-DD Fri  return    no-matching-train      <other trains in the window>
```

## Using it with Claude

- **Claude Code / desktop app:** copy the folder to `~/.claude/skills/trenitalia-commute/` and ask *"book my
  commute"* or *"reserve two days"*. Claude runs `book --confirm` (with `--count` when you name a number) and
  reports the booked days with their PNRs.
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
| automatic sign-in from `credential.xml` | verified from signed out to signed in, headless |
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
