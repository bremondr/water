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
- `weirs-nodata.json`: 26 more Elbe weirs/locks (Pardubice to Lovosice, plus 3 on the upper Labe) with **no** live data anywhere;
  they appear greyed as "bez dat". Compiled from OSM, cs.wikipedia (Střední/Dolní Labe vodní cesta) and Povodí Labe pages;
  `rkm` is the Elbe-km scheme. Hadík (a former stage) is deliberately left out. Entries not `high` confidence show as approximate.
- `climate.mjs`: long-term characteristics per station (ČHMÚ `characteristic/`: Qa, monthly avg/min/max flow, M-day flow-duration
  curve, reference period 1991-2020), served at `/api/climate`, cached 7 days. Level averages (`ha`) and `qa` come from station
  metadata and ride along in `/api/stations`.
- `experiments/flood/` + `dem.mjs` + `scripts/fetch-dem.mjs`: **experiment**, not part of the app. A 'bathtub with connectivity'
  flood extent: terrain from ČÚZK DMR 5G (ImageServer, 2 m grid, window of 5 km around a station, Web Mercator), water
  plane = gauge zero (`WGS_ELE` in the ČHMÚ metadata) + stage, flooded = below the plane and connected to the river.
  Open `/experiments/flood/` after `node scripts/fetch-dem.mjs <stationId>` (data is gitignored; four stations were fetched
  during development). The DEM shows rivers at their level during the LiDAR survey, so stages below that stay in the channel.
  Official flood zones (Q5/Q20/Q100/Q500/active zone) come from the VÚV WFS (`zones.mjs`, rasterised onto the same grid, bit per
  layer in `<id>.zones.bin`) and are drawn as outlines. **The WFS coordinates lack the S-JTSK to WGS84 datum shift** (outlines were ~70 m
  west and ~80 m south of the terrain): `zones.mjs` corrects it with `+towgs84=589,76,480`, and `npm run zone-offset <stationId>` checks the
  alignment against the terrain (residual about 10 m). Re-fetch zones after touching that code.
  `npm run fit-stage` prints, per station and zone, the gauge stage whose flat-plane flood best matches the zone next to the stage
  the rating curve gives for the same N-year flow. Result on 2026-10-15: Q100 agrees within ~0.1-0.8 m at all four stations (IoU 0.70-0.83).
  Zones are drawn as outlines, with precision/recall/IoU against the modelled extent. The page can tilt the
  water surface (slope in cm/km along the channel direction derived from the flat river in the DEM, optionally estimated from
  neighbouring gauges) and can search the stage that best matches a zone. Known limits are listed on the page; do not present it as
  a forecast or a flood map.
- **Corridor model** (experiment, builds on the above): `node scripts/fetch-corridor.mjs padUp=24000` builds a terrain corridor along the Labe from
  Ústí to above Kostelec (~96 km, 8 m cells, ~150 MB in `experiments/flood/data/corridor-labe/`, gitignored): terrain `z.bin`, river coordinate
  `s.bin` (metres upstream of the downstream end, from the VÚV river-reach centreline in `river.mjs`), official zones `zones.bin`, plus gauges,
  weirs and the peak levels of the 2002/2006/2013/2024 floods in `manifest.json`. `corridor.mjs` turns the levels of all gauges into a water surface
  along `s` (optionally flat pools with steps at weirs) and floods the connected cells below it; `experiments/flood/corridor-api.mjs` (loaded lazily
  by `server.mjs`, ~150 MB RAM) serves scenarios and PNG map tiles; the page is `/experiments/flood/corridor.html`. `npm run corridor-eval`
  compares the variants against the official zones for each event. Findings 2026-10-15: a single flat level over 96 km fits badly (IoU 0.3-0.5),
  the gauge profile fits well (0.6-0.8) and orders the events like their return periods (2024 matches Q5, 2006 Q20, 2013 Q100, 2002 exceeds Q100);
  weir steps make flood-stage fits worse (weirs are open in floods), so they are off by default.
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
- Colours: all tokens live in `:root` in `index.html` (light) with dark overrides. Status colours `--d0..d4`, `--dry` are for fills and
  markers only; as **text or chart lines** use the darker `--d0t..` variants, and badges use the `.badge.b-*` classes (fixed
  text/background pairs, white text fails on the yellow, orange and green). `test/contrast.test.mjs` checks the WCAG ratios of
  these tokens, so a palette change that breaks AA fails `npm test`.
