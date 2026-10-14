# Stavy a průtoky – prototype

Map of Czech river gauges and reservoirs. River data come from the ČHMÚ open data
(`opendata.chmi.cz/hydrology`); reservoir data are scraped from the five povodí portals.

```
node server.mjs      # http://localhost:8080 (PORT env var to change)
```

- `server.mjs` – backend: builds `/api/stations` (ČHMÚ) and `/api/reservoirs`, 10 min cache, serves `index.html`.
  The first station load takes ~40–90 s (about 1,600 small requests); later loads come from the cache.
- `dams.mjs` – reservoir scraper for Povodí Labe, Vltavy, Ohře, Odry and Moravy (same portal engine, no API).
- `dam-coords.json` – dam positions (`[lat, lon]`, third value `1` = approximate). Hand-editable.
- `geocode.mjs` – one-off OpenStreetMap lookup that produced the coordinates; keeps existing entries.
- `index.html` – the whole frontend (Leaflet from cdnjs, no build step).
- `_scratch/` – screenshots and saved pages from development; safe to delete.
