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
`commute.mjs` starts Chrome and needs network access; approve the command when Codex asks.

## Before the first booking (once per machine, both tools share it)

1. Install Node.js 18+ with npm and Google Chrome. In the **installed plugin's**
   `skills/trenitalia-commute/scripts/` folder, run `npm ci` to install `playwright-core`. The installed folder
   is under `%USERPROFILE%\.codex\plugins\cache\trenitalia-commute-local\trenitalia-commute\<version>\` for Codex,
   or `%USERPROFILE%\.claude\plugins\cache\trenitalia-commute-local\trenitalia-commute\<version>\` for Claude.
   Installing dependencies only in a source checkout does not install them in the plugin cache.
2. Ask the skill to set up your commute. It asks for the traveller and card, exact stations, service and departure
   window for each direction, free offer names and IDs, travel days, holidays, and seat preferences. It writes
   `config.json` in `%USERPROFILE%\.trenitalia-commute\`, outside the plugin. You can instead run
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<installed skill folder>\scripts\setup.ps1"` in your
   own terminal; it asks the same questions. Do not put personal values in this repository.
3. Save your Le Frecce sign-in through the local hidden prompt:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<installed skill folder>\scripts\save-credential.ps1" -Folder "$env:USERPROFILE\.trenitalia-commute"`.
   The script prints the destination path. Verify that it is the same folder as `config.json`, then run
   `node "<installed skill folder>\scripts\commute.mjs" login` and `status`. If sign-in is rejected or challenged,
   stop and resolve that before booking.

Personal data, the credential, the browser profile and the run logs live only in `~/.trenitalia-commute/`,
never in this folder.

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
