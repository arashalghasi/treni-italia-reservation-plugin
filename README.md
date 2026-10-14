# trenitalia-commute plugin (Claude Code and Codex)

One folder, two plugin formats, one skill. It books free abbonamento / Carta Tutto Treno seat reservations for a
daily train commute: it reads the account's trips, finds the configured train type per workday and books the
days still missing at €0.00 only. Setup, commands and rules are in
`plugins/trenitalia-commute/skills/trenitalia-commute/README.md`.

Not affiliated with, endorsed by or connected to Trenitalia or Gruppo FS Italiane. It drives the public website
on behalf of the account holder, for personal, non-commercial use; the site's terms of use apply, and the
operator may suspend or revoke access.

## Layout

| Path | Role |
|---|---|
| `.claude-plugin/marketplace.json` | Claude Code marketplace `trenitalia-commute-local` |
| `.agents/plugins/marketplace.json` | Codex marketplace `trenitalia-commute-local` |
| `plugins/trenitalia-commute/.claude-plugin/plugin.json` | Claude Code plugin manifest |
| `plugins/trenitalia-commute/.codex-plugin/plugin.json` | Codex plugin manifest (display texts, default prompts) |
| `plugins/trenitalia-commute/skills/trenitalia-commute/` | the skill, shared by both: `SKILL.md`, `config.example.json`, `scripts/`, `README.md` |
| `plugins/trenitalia-commute/skills/trenitalia-commute/agents/openai.yaml` | Codex-only display name and default prompt |
| `sync-from-claude-skill.ps1` | copies a standalone copy of the skill folder in again after it changes |

## Install in Claude Code or Claude Desktop Code

```powershell
claude plugin marketplace add arashalghasi/treni-italia-reservation-plugin
claude plugin install trenitalia-commute@trenitalia-commute-local
```

Start a new Claude Code session (or a new Code session in Claude Desktop), then ask:
*"Set up my Trenitalia commute."* Claude will ask for the required trip details.

## Install in Codex Desktop

```powershell
codex plugin marketplace add arashalghasi/treni-italia-reservation-plugin
codex plugin add trenitalia-commute@trenitalia-commute-local
```

In Codex Desktop, open a new chat and ask: *"Use $trenitalia-commute to set up my commute."* You can also
find the plugin under **Plugins** after adding the marketplace. Later ask for the specific dates to reserve.
`commute.mjs` starts Chrome or Edge and needs network access; approve the command when Codex asks.

## Update an existing installation

After a new release, refresh the marketplace and reinstall the plugin, then run `npm ci` in the new installed
`scripts/` folder. The private `~/.trenitalia-commute/` folder is separate from the plugin cache.

```powershell
claude plugin marketplace update trenitalia-commute-local
claude plugin update trenitalia-commute@trenitalia-commute-local
codex plugin marketplace upgrade trenitalia-commute-local
codex plugin add trenitalia-commute@trenitalia-commute-local
```

Restart Claude or open a new Codex chat to load the updated skill. Version 1.0.6 requires the user to sign in
in the visible plugin browser. `login`, `status` and `book` continue after the account session is verified.

## Before the first booking (on each workstation)

1. Install Node.js 22+ with npm and Google Chrome or Microsoft Edge. In the **installed plugin's**
   `skills/trenitalia-commute/scripts/` folder, run `npm ci` to install the locked `playwright-core` version. The installed folder
   is under `%USERPROFILE%\.codex\plugins\cache\trenitalia-commute-local\trenitalia-commute\<version>\` for Codex,
   or `%USERPROFILE%\.claude\plugins\cache\trenitalia-commute-local\trenitalia-commute\<version>\` for Claude.
   On macOS/Linux the cache is under `~/.codex/plugins/cache/` or `~/.claude/plugins/cache/`. Installing dependencies
   only in a source checkout does not install them in the plugin cache. Repeat `npm ci` after a plugin update.
2. Ask the skill to set up your commute. It asks for the traveller and card, an account holder surname if different,
   exact stations, service and departure
   window for each direction, free offer names and IDs, travel days, holidays, and seat preferences. It writes
   `config.json` in `~/.trenitalia-commute/`, outside the plugin. On Windows you can instead run
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<installed skill folder>\scripts\setup.ps1"` in your
   own terminal; it asks the same questions. Do not put personal values in this repository or copy a colleague's
   config without reviewing the traveller, route, fare and time windows.
3. Run `node "<installed skill folder>\scripts\commute.mjs" doctor` (on macOS/Linux, use `/` path separators).
   It checks Node, Playwright, browser launch and config without visiting Le Frecce.
   Run it in the same execution context that will run bookings: a sandboxed agent can see a different Node version
   or browser profile from your own terminal. `doctor.runtimeReady` covers only the local program
   setup; it does not test whether Le Frecce will accept authentication from that environment.
   Set `TRENITALIA_BROWSER_CHANNEL=msedge` to use Edge, or `CHROME_PATH` to select a custom Chromium executable.
4. Run `node "<installed skill folder>/scripts/commute.mjs" login` on your computer, then sign in yourself in the
   visible browser window the plugin opens. The plugin does not read or submit your password. It uses a dedicated
   browser profile, so being signed in in your everyday Chrome window does not sign in the plugin. The session
   persists until Le Frecce expires it. A visible `status` or `book` run will prompt for manual sign-in again when
   needed, then continue after checking the account and its trips.
5. Run `status` before booking. If it reports a site access block, explicit credential rejection, challenge,
   network failure, account mismatch or unreadable trip list, stop and resolve that specific error. Do not retry
   a rejected or unverified password in a loop.

An unattended or `--headless` run can reuse a verified session in this profile. If it has expired, the run stops
and asks for a visible local login; it never submits a saved or environment password. A workstation's browser
policy can also prevent automation even when ordinary browsing works; `doctor` reports browser launch separately
from website login. An older `credential.xml` remains in your private folder if you created one; version 1.0.6
does not read it. You can delete that file yourself when you no longer need it.

A cloud network may receive an HTML Access Denied response from the site's edge on the login request even when
public train search and free-fare selection work. This does not verify or disprove the credentials. Run the plugin
on your own computer and network, then use `login` in its visible, dedicated browser profile. The usual browser,
the plugin profile and a cloud environment have separate sessions. On a Linux host without `DISPLAY` or
`WAYLAND_DISPLAY`, a visible login cannot open. Do not use proxy or IP changes, CAPTCHA workarounds or copied
browser cookies to bypass a site block.

Personal config, the browser profile and the run logs live only in `~/.trenitalia-commute/`,
never in this folder.

The browser and Node requirements follow [Playwright's supported platforms](https://playwright.dev/docs/intro)
and [browser channels](https://playwright.dev/docs/browsers).

Installation commands follow the [Claude plugin guide](https://code.claude.com/docs/en/plugins) and the
[Codex plugin guide](https://developers.openai.com/plugins/build/plugins).

## After changing the skill

Edit the skill here, or edit a standalone copy and pull it in:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin folder>/sync-from-claude-skill.ps1" -Source "<standalone skill folder>"
```

Bump `version` in both `plugin.json` files and in `.claude-plugin/marketplace.json`, then update the installed
plugin (`claude plugin update trenitalia-commute@trenitalia-commute-local`, `codex plugin add
trenitalia-commute@trenitalia-commute-local`).
