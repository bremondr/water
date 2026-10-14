# water: Czech river gauges and reservoirs map

Prototype web app. Node 20+ (ESM, no dependencies, no build step). UI language is Czech.

## Commands
- `npm start`: server on http://localhost:8080 (`PORT` env var changes it).
- `npm test`: offline parser/cache/basin tests (`node --test "test/*.test.mjs"`).
- `npm run fixtures`: re-saves the live portal pages into `test/fixtures/` (needs network). Run it when a portal
  changes layout, then fix the parser until the tests pass again.
- `npm run geocode`: looks up missing dam positions in OpenStreetMap, keeps existing entries.

## Layout
- `server.mjs`: HTTP server and the ČHMÚ station builder. `/api/stations`, `/api/reservoirs`, serves `index.html`.
- `dams.mjs`: scraper + pure functions (`parseTable`, `joinTables`, `finalizeReservoirs`) for the five povodí portals.
- `weirs.mjs`: Elbe weirs/locks (Střekov, Opatovice nad Labem) scraped from Povodí Labe station pages; they ride along in
  `/api/reservoirs` as `weirs` and show in the "Nádrže a jezy" mode. Only stations whose level is in m n. m. are weirs (2 of 124).
- `basins.mjs`: station → povodí mapping from the hydrological order number (approximate).
- `cache.mjs`: stale-while-revalidate cache persisted to `.cache/` (gitignored). A restart serves the last good data
  instantly. A failed refresh keeps the previous value.
- `index.html`: the whole frontend (Leaflet from cdnjs). Station mode and reservoir mode share one map and sidebar.
- `dam-coords.json`: `"pla:107": [lat, lon]`, a third value `1` means **approximate position** (shown with a dashed
  ring and a notice in the UI). Hand-editable. Dams without an entry are not shown.
- `docs/licensing-and-terms.md`: **unresolved** licensing/terms questions. Read before publishing anything.
- `_scratch/` (gitignored): screenshots and saved pages from development.

## Things that are easy to get wrong
- The ČHMÚ server sends no CORS headers, so the browser cannot call it. Everything goes through `server.mjs`.
- The povodí portals have **no API**. All five run the same MGE Data portal and are scraped from HTML tables. The
  `Objemy.aspx` page reuses the same element ids with a different meaning per column (see the comment in `dams.mjs`).
  `getPage()` follows the portal's `WaitPage` redirect by hand because the session cookie must survive it.
- Dam keys are `<platform>:<portal id>` (e.g. `pvl:VLOR`). Ids are only unique within one povodí.
- Vltava cascade (Orlík, Kamýk, Slapy, Štěchovice) is published with outflow exactly 0,00. That is a placeholder, not a
  measurement. `finalizeReservoirs` hides it and `index.html` shows the ČHMÚ gauges Zbraslav and Praha-Chuchle
  instead (`CASCADE_REF`).
- Times from the portals are local Czech time strings; ČHMÚ series are UTC epoch seconds.
- When a portal fails, `/api/reservoirs` keeps that povodí's last known dams (flagged `stale`) and lists it under
  `errors`; the others keep working.
- Do not shorten the 10-minute cache TTL casually: see the politeness section in the licensing notes.
- On Windows/Git Bash, very large heredocs with quotes can fail; write files with the editor tools instead.
- Edits to `dam-coords.json` are baked into the cached `/api/reservoirs` response; delete `.cache/reservoirs.json`
  and restart (or wait out the 10-minute TTL) to see them.
