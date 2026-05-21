# CONTRIBUTING_AI.md

Future AI assistants should read this file before changing the AIC web app, database migrations, server deployment scripts, or worker services.

## Repository And Server Roles

This repo is the AIC web app:

- GitHub repo: `https://github.com/ammonsfarm/aic.git`
- Local checkout: `/Users/van/firebase/aic`
- Server checkout: `ssh farm` then `/mnt/storage/aic`
- Live service: `aic-web.service`
- Public tunnel target: `http://127.0.0.1:8087`

The podcast/data automation workspace is separate:

- Local podcast workspace: `/Users/van/firebase/aic_podcast`
- Server podcast workspace: `ssh farm` then `/mnt/storage/aic_podcast`
- Gemini transcription workspace: `ssh farm` then `/home/ammonsfarm/gemini-transcribe`

Do not assume a local edit is live. The server only changes after code is pushed to GitHub and deployed to `farm`, or after an explicit server-side copy/change.

## Normal Web App Deployment Flow

For web app changes, use this path unless the user explicitly asks for local-only work:

```bash
cd /Users/van/firebase/aic
npm run lint
npm run build
git status --short
git add <changed-files>
git commit -m "<clear message>"
git push origin main
npm run deploy:farm
```

`npm run deploy:farm` SSHes to `farm`, pulls `main` into `/mnt/storage/aic`, runs `npm ci`, applies Postgres migrations, builds the Next app, installs the transcript edit worker timer, restarts `aic-web.service`, and health-checks port `8087`.

After deployment, verify:

```bash
ssh farm 'cd /mnt/storage/aic && git rev-parse --short HEAD && systemctl is-active aic-web.service && curl -fsS http://127.0.0.1:8087/login >/dev/null && echo ok'
```

## Server Workers

Transcript edit processing is installed on `farm` as:

- `aic-transcript-edit-worker.timer`
- `aic-transcript-edit-worker.service`

Verify it with:

```bash
ssh farm 'systemctl is-active aic-transcript-edit-worker.timer && journalctl -u aic-transcript-edit-worker.service -n 40 --no-pager'
```

## Coordination Rules

- Before editing, inspect `git status --short`.
- Do not overwrite or revert changes you did not make.
- If another agent has uncommitted files, inspect the diff and work with it.
- Keep file ownership narrow and avoid unrelated refactors.
- Only one agent should push/deploy at a time.
- If a server process or tmux job is running, do not stop/restart it unless the user explicitly asks.

## Required Final Report

When moving changes to `farm`, state:

- which local files changed;
- whether changes were committed and pushed;
- which server path was updated;
- which service, timer, or process was restarted or left untouched;
- the exact validation command and result.

Never print secrets from `.env`, session tokens, Clerk keys, OpenAI keys, Gemini keys, Podtrac auth material, or copied auth profiles.
