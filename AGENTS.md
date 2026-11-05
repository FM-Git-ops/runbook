# Agent instructions

## Runbook workflows

This repo holds Runbook workflows for Faisal Masum Org, in `workflow-definitions/faisal-masum-org-1793879462547241895/workflows/<slug>/`. Build, validate, upload and simulate them with the `rb` CLI (`rb --help`).

Load the `rb-interact` skill (`.claude/skills/rb-interact/` or `.agents/skills/rb-interact/`) before any Runbook task, including editing anything under `workflow-definitions/`; it says which other `rb-` skill each task needs. The skill folders are gitignored, so they match each person's rb: if they are missing (a fresh clone), install rb (`curl -fsSL https://api-interview.myrunbook.com/rb/install.sh | sh` (Windows PowerShell: `irm https://api-interview.myrunbook.com/rb/install.ps1 | iex`), then `rb env interview` and `rb auth login --org faisal-masum-org-1793879462547241895`) and run `rb init` in this repo.

When rb says you are not signed in, run `rb auth login`, show the user the link and code it prints, and run `rb auth login` again once they approve. Never ask for an API key in chat.
