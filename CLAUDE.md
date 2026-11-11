# water: Czech river gauges and reservoirs map

**Branch `pages`**: static version for GitHub Pages. The flood experiment (terrain, zones, corridor model) lives only on `main`.

Prototype web app. Node 20+ (ESM, no dependencies, no build step). UI language is Czech.

## Commands
- `npm start`: local server on http://localhost:8080 (`PORT` env var changes it). Serves the same `data/*.json` files the static site has.
- `npm run build`: static build into `site/` (gitignored): `index.html`, `climate.mjs`, `data/{stations,reservoirs,climate}.json`. Sources younger than
  their TTL are not fetched again (`STATIONS_TTL_MIN` 25, `RESERVOIRS_TTL_MIN` 55, `CLIMATE_TTL_MIN` 10080). Exits 1 if a source has no data at all.
- `npm test`: offline parser/cache/basin tests (`node --test "test/*.test.mjs"`).
- `npm run fixtures`: re-saves the live portal pages into `test/fixtures/` (needs network). Run it when a portal
  changes layout, then fix the parser until the tests pass again.
- `npm run geocode`: looks up missing dam positions in OpenStreetMap, keeps existing entries.

## Layout
- `builders.mjs`: ČHMÚ station builder and reservoir/weir builder, shared by the server and the static build. Past days (D-1, D-2) persist in
  `.cache/past.json`, so a build only asks ČHMÚ for today's files (~550 requests).
- `server.mjs`: local dev server, `data/stations.json`, `data/reservoirs.json`, `data/climate.json`, `climate.mjs`, `index.html`.
- `scripts/build-static.mjs` + `.github/workflows/pages.yml`: every 30 min (and on push to `pages`) restore `.cache/` from the Actions cache, run tests,
  build, deploy with `deploy-pages`. Scheduled runs are the only thing that touches the sources; GitHub delays them by 5-20 min, so the data is
  25-60 min old. Nothing is committed. Public repos get scheduled workflows disabled after 60 days without commits.
- `docs/pla-portal-features.md`: research on what the PLA portals offer that we do not (2026-11-11), with pitch notes.
- `dams.mjs`: scraper + pure functions (`parseTable`, `joinTables`, `finalizeReservoirs`) for the five povodí portals.
- `weirs.mjs`: Elbe weirs/locks (Střekov, Opatovice nad Labem) scraped from Povodí Labe station pages; they ride along in
  `/api/reservoirs` as `weirs` and show in the "Nádrže a jezy" mode. Only stations whose level is in m n. m. are weirs (2 of 124).
- `weirs-nodata.json`: 26 more Elbe weirs/locks (Pardubice to Lovosice, plus 3 on the upper Labe) with **no** live data anywhere;
  they appear greyed as "bez dat". Compiled from OSM, cs.wikipedia (Střední/Dolní Labe vodní cesta) and Povodí Labe pages;
  `rkm` is the Elbe-km scheme. Hadík (a former stage) is deliberately left out. Entries not `high` confidence show as approximate.
- `climate.mjs`: long-term characteristics per station (ČHMÚ `characteristic/`: Qa, monthly avg/min/max flow, M-day flow-duration
  curve, reference period 1991-2020), served at `/api/climate`, cached 7 days. Level averages (`ha`) and `qa` come from station
  metadata and ride along in `/api/stations`.
- `basins.mjs`: station → povodí mapping from the hydrological order number (approximate).
- `cache.mjs`: stale-while-revalidate cache persisted to `.cache/` (gitignored). A restart serves the last good data
  instantly. A failed refresh keeps the previous value.
- `index.html`: the whole frontend (Leaflet from cdnjs). Station mode and reservoir mode share one map and sidebar. Fetches `data/*.json` relative to the page.
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
- Colours: all tokens live in `:root` in `index.html` (light) with dark overrides. Status colours `--d0..d4`, `--dry` are for fills and
  markers only; as **text or chart lines** use the darker `--d0t..` variants, and badges use the `.badge.b-*` classes (fixed
  text/background pairs, white text fails on the yellow, orange and green). `test/contrast.test.mjs` checks the WCAG ratios of
  these tokens, so a palette change that breaks AA fails `npm test`.
