# Licensing, terms of use and politeness: open questions

Status: **not resolved.** This is a private prototype. Nothing here has been cleared with the data owners.
Resolve every item under "Before this goes public" before publishing a live site or sharing the repo.
Last reviewed: 2026-10-14.

## Data sources and what we know

### ČHMÚ open data (river stations)
- Source: `https://opendata.chmi.cz/hydrology/` (`now/`, `recent/`, metadata).
- Terms: the ČHMÚ "Podmínky použití" (conditions of use). A web search summarised them as: cite ČHMÚ as the
  source; data are provided as stored at the time; data may **not** be used to issue warnings or to build
  products/services for crisis management or the integrated rescue system; third-party data are excluded.
  **Second-hand only.** The original PDF link found (`chmi.cz/files/portal/docs/hydro/denni_data/Podminky_uziti.pdf`)
  returns 404, so the current official text has not been read.
- It is **not** confirmed to be CC BY 4.0 (that licence belongs to ČÚZK, a different agency).
- The app shows flood-activity degrees (1. až 3. SPA, extrémní povodeň) coloured on a map. That is close to a
  warning product. Decide with the exact terms in hand whether that is allowed, and add a visible
  "informativní údaje, nejde o výstražnou službu" disclaimer either way.
- Attribution today: only "zdroj ČHMÚ" in the sidebar subtitle. Probably needs the full wording the terms ask for.

### Povodí reservoir portals (reservoirs)
- Sources: scraped HTML tables from the five state-enterprise portals (Povodí Labe, Vltavy, Ohře, Odry, Moravy).
  See `PLATFORMS` in `dams.mjs`. No API and no published reuse terms were found.
- The portals are built by MGE Data s.r.o. (footer: "Aplikace vyrobena firmou MGE Data s.r.o."), so rights
  may be split between the povodí (data) and MGE Data (application).
- Pages carry a disclaimer: "Veškerá uváděná data jsou bez záruky". Our UI should carry an equivalent.
- `robots.txt` as of 2026-10-14:
  - `www.pla.cz`: allows everything.
  - `sap.poh.cz`: only a Cloudflare "content signals" preamble with **no signals set**, plus an express reservation
    of rights under Art. 4 of EU Directive 2019/790 (text and data mining). Neither grants nor restricts, but
    it signals that the operator cares.
  - `www.pod.cz`: disallows a long list of named AI crawlers (including `anthropic-ai`) from the whole site.
    Our scraper sends `User-Agent: Mozilla/5.0 (compatible; povodi-prototype)`, which is not on the list, but
    the intent is clear. Treat Povodí Odry as the most sensitive source.
  - `www.pvl.cz` and `sap.pmo.cz`: no robots.txt (404/redirect). `www.pmo.cz`: standard WordPress file.
- Scraping is fragile and legally unclear. The preferred fix is to **ask each povodí for permission or a data feed**.

### OpenStreetMap
- Map tiles: attribution "© OpenStreetMap" is shown. The public tile server is for light use only
  (https://operations.osmfoundation.org/policies/tiles/). Heavy or public use needs a tile provider.
- `dam-coords.json` was produced from Nominatim (OSM data, ODbL) plus hand placement. OSM-derived data needs
  attribution and the ODbL may impose share-alike on a published database. Check before publishing that file.
  `geocode.mjs` follows the Nominatim policy (1 request/s, identifying User-Agent).

### Other
- Leaflet 1.9.4 (BSD-2-Clause) loaded from cdnjs.
- Mapy.com (Mapy.cz) was only used as a manual research aid for dam positions. Do not copy coordinates from it
  in bulk: its terms restrict that. Positions found there should be confirmed independently (OSM, official sources).

## Politeness towards the sources
- ČHMÚ: a full station refresh is ~550 requests every 10 minutes (the two previous days are cached in memory
  and fetched once per day). The server refreshes on its own timer while it runs, even with no visitors.
  For anything public, lengthen the interval and/or ask ČHMÚ whether a bulk file exists.
- Povodí portals: 10 requests per refresh (2 pages × 5 portals) every 10 minutes.
- Do not reduce the cache TTL without thinking about this.

## Before this goes public (checklist)
- [ ] Find and read the current ČHMÚ terms of use; write the exact required attribution into the UI.
- [ ] Decide whether showing flood-activity degrees is a "warning" use under those terms; add a disclaimer.
- [ ] Ask each povodí (and MGE Data) for permission to reuse the reservoir data, or for an official feed.
- [ ] Re-check robots.txt of all five portals at that time; honour any restrictions.
- [ ] Add a visible "data bez záruky / informativní" disclaimer and a sources/attribution page in the app.
- [ ] Replace the public OSM tile server with a provider that allows the expected traffic.
- [ ] Review the ODbL implications of publishing `dam-coords.json`.
- [ ] Decide whether the repo may become public (it contains scraper code and positions derived from OSM).
