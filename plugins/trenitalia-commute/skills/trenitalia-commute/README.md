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
| `scripts/save-credential.ps1` | saves the lefrecce.it username and password encrypted (Windows DPAPI only) for automatic sign-in |
| `scripts/setup.ps1` | first-run questionnaire for personal config and encrypted sign-in credential |

Personal state, all in `~/.trenitalia-commute/` (Windows: `%USERPROFILE%\.trenitalia-commute\`):
`config.json`, `credential.xml` (optional), `browser-profile/` (the script's own signed-in Chrome profile),
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
   the Le Frecce sign-in, it directs you to a local hidden credential prompt. Alternatively, run the complete
   questionnaire in your own PowerShell terminal; it asks all of these questions and the hidden sign-in prompt.
   Config and the Windows-encrypted credential are saved under `%USERPROFILE%\.trenitalia-commute`, outside the
   plugin and Git repository.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill folder>\scripts\setup.ps1"
   ```

   If you already have a config and only need to replace the saved sign-in, run `save-credential.ps1` instead.
   To replace an existing config intentionally, pass `-Force` to `setup.ps1`.

4. Run `doctor` to check the local runtime, then verify sign-in. A browser window opens on the script's own
   profile; the session is kept for later runs. Each Windows user on each computer must save their own credential.
   A credential XML file copied from another computer cannot be decrypted.

   ```powershell
   node "<skill folder>\scripts\commute.mjs" doctor
   node <skill folder>\scripts\commute.mjs login
   ```

   On macOS/Linux, ask the skill to write the private config, then run `login --manual` and sign in in the plugin
   browser window. On any OS this also works when automatic sign-in is rejected. `--manual` does not submit the
   saved credential. The ordinary Chrome profile and plugin profile are separate. For unattended runs outside
   Windows, `TRENITALIA_USERNAME` and `TRENITALIA_PASSWORD` can be supplied securely in the run environment;
   never put them in the config, command line or logs.

## Commands

```powershell
node commute.mjs doctor                 # check workstation setup; visits no website
node commute.mjs status                 # next 20 working days
node commute.mjs status --days=5        # shorter window
node commute.mjs status --from=YYYY-MM-DD
node commute.mjs status --visible       # with a Chrome window, to watch
node commute.mjs book --confirm         # book every day the account still misses (both legs), €0,00 only
node commute.mjs book --count=2 --confirm   # only the next two such days
node commute.mjs book --from=2030-06-01 --until=2030-06-10 --confirm  # only missing days in this range
node commute.mjs book --until=2030-06-30 --confirm  # never book after this date
node commute.mjs book --on=2030-06-12 --leg=outbound --count=1 --confirm  # one specified missing leg
node commute.mjs book --count=1         # dry run: stops on the payment page, books nothing
node commute.mjs login                  # sign in from the local saved credential
node commute.mjs login --manual         # skip saved credential; wait for local browser sign-in
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
