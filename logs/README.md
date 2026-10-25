# LogiXair Gulf operations record — daily logs

Day 1 began at 06:00 AST (Saudi time) on 25 Oct 2026. Every operating day runs 06:00 → 06:00 AST, and one simulated day is one calendar day.
The GitHub Action in `.github/workflows/record.yml` flies the shared record forward every hour and, when a day closes, writes it here:

- `days.csv` — one row per day per line (MM Gulf middle-mile, OF Gulf offshore, RS Red Sea islands, DS Desert oil camps) plus an ALL row: revenue in SAR (dry and wet), tonnes, tonne-km, pods, consignments, legs, empty legs, load factor, flight hours, holds, late legs, checks, aircraft stood down, the day's demand factor and any calendar event.
- `day-NNN.json` — the full day: totals per line, per hub and per corridor, and every leg flown (times in seconds since 25 Oct 2026 00:00 AST).
- `index.json` — the list of archived days.

The running state lives on the `record` branch (`state.json.gz`), which `index.html` loads so every viewer opens on today.
