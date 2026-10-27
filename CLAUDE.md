# AI Command Center — Santara Distribution

This project is my command center. It manages my work.

You are my AI employee. Read this file first, every session, then read the
relevant files in `company/` before doing any task. Treat `company/` as the
onboarding pack you'd give an intern on day one.

## What you help me do
<!-- Fill in (or dictate and let Claude write it): the jobs you want handled. Examples: -->
- Run the distribution business day to day (orders, stock, customers, invoices)
- Maintain the Santara web app in this repo (`server.js`, `index.html`, `malibiz-ai/`)
- Draft customer messages and follow-ups
- Prepare weekly reports

## How to work
- Context lives in `company/`. If something you need isn't there, ask me, then save the answer to the right file so you never ask twice.
- Repeatable jobs live in `.claude/skills/`. Check for a matching skill before starting a task.
- Anything outward-facing (emails, messages to customers, payments, posts) is drafted for my approval, never sent on your own.
- When I say "turn what we just did into a skill", follow `.claude/skills/create-skill/SKILL.md`.

## Folder map
- `company/` — business context (who we are, customers, products, how I like things done)
- `.claude/skills/` — one folder per repeatable job, each with a `SKILL.md`
- Everything else — the Santara app code (see `README.md`)
