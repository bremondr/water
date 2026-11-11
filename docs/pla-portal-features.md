# Povodí Labe (PLA) web features: research notes

Researched 2026-11-11 by a subagent (about 31 page fetches, no forms, no login). WebFetch returns a model summary, not raw HTML,
so markup facts (image maps, script URLs, JSON endpoints) were **not** checked. V = verified from page text, G = guess.
Purpose: decide which features a modern replacement UI should cover, and material for a pitch to PLA.

## Features

| Feature | URL (base `https://www.pla.cz/portal/`) | What it shows | Format | In our app? |
|---|---|---|---|---|
| Celková mapa (Stavy a průtoky) | `sap/cz/pc/CelkovaMapa.aspx` | Static PNG map with clickable station icons coloured by SPA, trend arrows (rise ≥ 30 cm / 3 h, fall ≥ 20 cm / 3 h), list of ~124 stations, filter by závod | HTML + static PNG | Yes, better (Leaflet). Trend arrows no |
| Přehled měření | `sap/cz/pc/Prehled.aspx` (`?oid=1\|2\|3`, `?rad=`) | ~150 stations: latest H and Q with times, Qa, Q355, **remark** (station fault, below gauge zero, backwater), sparkline PNG | HTML table | Partly (we use ČHMÚ; no remark column) |
| Station detail | `sap/cz/pc/Mereni.aspx?id=<ID>&oid=<1-3>` | SPA thresholds, Q355, N-year flows, top 3 historical floods, H/Q table (today + 5 daily values), rating-curve PNG, cross-section PNG | HTML table + PNG | SPA and N-year yes; floods, curve, profile no |
| Srážky | `srazky/cz/pc/CelkovaMapa.aspx`, `Prehled.aspx` | Rain gauges: 24 h precipitation, air temperature | HTML + PNG | **No** |
| Nádrže, Objemy | `nadrze/cz/pc/CelkovaMapa.aspx`, `Objemy.aspx` | Storage / controllable retention / uncontrollable retention volume per reservoir | HTML table | Yes (`dams.mjs`) |
| Jakost vody v nádržích | `jvn/cz/index.htm` | Transparency, temperature, chlorophyll in 16 reservoirs (Mar-Oct) | HTML + map | **No** |
| Dispatch PDFs | `planet/projects/webservices/GetFileFromDB/ukaz_soubor.ashx?id=...` | Hydrologická situace, Zpráva o povodňové situaci, Mimořádné manipulace | PDF only | No |
| Zprávy o suchu / hydrologické situaci | `planet/webportal/internet/cs/dokumenty/zpravy-o-hydrologicke-situaci-2026_20085.html` | ~fortnightly PDF reports | PDF | No |
| Historické povodně | `planet/webportal/internet/cs/obsah/historicke-povodne--sucha_6181.html` | Final flood reports 1995-09/2024 | PDF | No |
| Ke stažení | `planet/webportal/internet/cs/obsah/ke-stazeni_5664.html` | SHP: flood zones Q5-Q500, active zones, historic floods (1997, 1998, 2000, 2002, 2006, 2010, 2013, 2014), hectometre points | Shapefile | Zones via VÚV WFS in the experiment |
| Apps | Play `cz.pla.sap`, `cz.pla.nad`, `cz.pla.srazky`, "Labe TPE"; iOS: Stavy a průtoky | Same data | App | n/a, feed undocumented |
| Labská vodní cesta | `lavdis.cz` (unreachable), `lvvc.cz/databaze.php`, PDFs | Navigation status, lock hours | PDF + external | Locks only |

Not found anywhere: RSS, API or JSON endpoint, CSV export, measurement archive or date range, own forecasts, public manipulation orders.

## Features we lack, by value and effort
1. PLA remark column and top-3 historical floods per station (HTML, low effort). Check first what ČHMÚ metadata already gives.
2. Precipitation layer (PLA Srážky, or ČHMÚ rain gauges as an independent source).
3. Retention-volume zones from `Objemy.aspx` in the UI (we scrape the page already; check whether all three zones are shown).
4. Document feed linking the dispatch and drought PDFs (low to link, high to extract data).
5. Reservoir water quality (low to medium).
6. Trend arrows computed from the ČHMÚ series (low).
7. Historic flood extents (SHP) as validation data for the flood corridor experiment.
8. Navigation (LVC) status; rating curves derived from H/Q pairs.
9. Push alerts: legally sensitive, see `licensing-and-terms.md`.

## Pitch material
- Data published only as images or PDF: rating curve, cross-section, situation and flood reports, extraordinary manipulations, drought reports, navigation status, and the station map itself (static PNG).
- No export, archive, API or open-data statement. "Poskytování informací" only covers requests under Act 106/1999 Sb.
- Old design: three separate Android apps and a separate `/smartphone/` layout instead of one responsive page; pre-rendered chart PNGs; footer "© 1996-2020 MGE Data".
- Content oddities seen: Bakov shows Q355 = 5,380 m³/s next to Q100 = 656 (looks like a decimal-comma error); the situation PDF metadata is dated 9.2.2000; Objemy lists 17 reservoirs, the map 16.
- Accessibility: PLA's own statement (2025-11-11) says the main site is only partially compliant, old PDFs are the weak spot. The portal was not audited here.
- Four separate portals (sap, nadrze, srazky, jvn) plus lavdis.cz, lvvc.cz and voda.gov.cz: one map with layers is the obvious selling point.
- PLA issues no warnings of its own, it links to ČHMÚ. Keep the disclaimer.

## Terms and contacts
- No terms of use or open-data licence found. Only "Veškerá uváděná data jsou bez záruky" and "data are not validated". Footer: © Povodí Labe, ČHMÚ; © 1996-2020 MGE Data.
- Registry: podatelna@pla.cz, +420 495 088 111, Víta Nejedlého 951/8, 500 03 Hradec Králové, IČO 70890005, IDDS dbyt8g2.
- Dispatch (VHD): vhd@pla.cz (from a search result, not verified), 495 088 730 / 720.
- Accessibility statement: https://www.pla.cz/planet/webportal/internet/cs/dokumenty/prohlaseni-o-pristupnosti_19245.html
- Poskytování informací: https://www.pla.cz/planet/webportal/internet/cs/obsah/poskytovani-informaci_6141.html
- Data pro vás: https://www.pla.cz/planet/webportal/internet/cs/obsah/data-pro-vas_5663.html

## Open items
Raw HTML of the portal (does chart data come from a JSON endpoint? what do the apps call?), reservoir detail page, rain-gauge rows, water-quality rows, PDF contents and the second page of "Ke stažení" were not read.
