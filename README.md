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

## Install in Claude Code

```powershell
claude plugin marketplace add "<plugin folder>"
claude plugin install trenitalia-commute@trenitalia-commute-local
```

Then ask in a new session: *"book my commute"* or *"reserve the next two days"*.

## Install in Codex

```powershell
codex plugin marketplace add "<plugin folder>"
codex plugin add trenitalia-commute@trenitalia-commute-local
```

Then ask in a new session: *"Use $trenitalia-commute to book the commute days my account is still missing."*
`commute.mjs` starts Chrome and needs network access: approve the command when Codex asks.

## Before the first booking (once per machine, both tools share it)

1. `npm install` in `plugins/trenitalia-commute/skills/trenitalia-commute/scripts/` (`playwright-core`, drives the
   Chrome already installed; no browser download).
2. Personal config: copy `config.example.json` to `~/.trenitalia-commute/config.json` and fill the `CHANGE-ME`
   values.
3. Credential for automatic sign-in, typed by you into the prompt (Windows, encrypted for your user only):
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill folder>/scripts/save-credential.ps1"`.

Personal data, the credential, the browser profile and the run logs live only in `~/.trenitalia-commute/`,
never in this folder.

## After changing the skill

Edit the skill here, or edit a standalone copy and pull it in:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin folder>/sync-from-claude-skill.ps1" -Source "<standalone skill folder>"
```

Bump `version` in both `plugin.json` files and in `.claude-plugin/marketplace.json`, then update the installed
plugin (`claude plugin update trenitalia-commute@trenitalia-commute-local`, `codex plugin add
trenitalia-commute@trenitalia-commute-local`).
