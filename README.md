# Dink Day – pickleball round-robin runner
Mobile-first PWA for running gym pickleball sessions: round robin, mix-up, mixed doubles, set partners, King of the Court, ladder, 4-player team battles, plus seeded playoffs. No sign-in: name + optional DUPR.
Shared state: anonymous event code → Neon Function (`server/index.ts`) storing JSON in Postgres. Players refresh to see updates. Offline edits are saved locally and pushed on reconnect.
- `npm run dev` · `npx vitest run` (pairing engine) · `npx playwright test` (mobile E2E) · `npm run deploy`
Original code; not affiliated with Swish Sports.
