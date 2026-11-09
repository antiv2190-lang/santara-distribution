---
name: seed-funders
description: >-
  Funder Finder (grants and impact investors, worldwide, FR/EN). Researches
  grant-makers, foundations, development agencies, EU/UN programmes and impact
  investors that fit a social-development project (youth employment, women's
  economic inclusion, innovation) in Mali / West Africa, and ranks them by fit
  with the reasons and a source link on every row. Public sources only. Writes
  seed/funders.json. Use when the user says "trouver des bailleurs",
  "subvention", "investisseurs d'impact", "find funders", "grants", "impact
  investors", or after /seed-plan.
---

# seed-funders

Replaces the SEC/VC search of /seed-investors for non-profit and impact projects.

## Rules
- Public sources only (the funder's own site, official calls, press). A source URL on every row. No URL, no row.
- Never invent a funder, deadline, amount or eligibility rule. Write "to verify" when unsure.
- State each row's type: grant, concessional loan, impact equity, prize, in-kind.
- Fit score 0-100: theme match, geography (Mali / Sahel / West Africa / Africa), ticket size vs the ask, eligibility (NGO vs company; Malian entity?), deadline, language.
- Output bilingual (FR first, EN second) when the user asks for FR/EN.
- Say plainly: no funding is guaranteed. Never contact a funder without the user's yes.

## Steps
1. Read seed/config.json and seed/plan.json if present; otherwise state assumptions aloud and ask the user to correct them.
2. Search by lanes: (a) bilateral/multilateral donors, (b) foundations, (c) EU/UN/World Bank/AfDB programmes, (d) impact funds and DFIs, (e) challenge funds/prizes for youth, women and innovation, (f) local/regional (Mali, UEMOA, ECOWAS).
3. For each candidate record: name, type, themes, ticket range, eligibility, deadline, language, source URL, fit score and reasons.
4. Write seed/funders.json (array of rows) and show a ranked table.
5. Hand off to /seed-deck and /seed-coach; draft applications only on request.
