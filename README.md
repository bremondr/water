# Stavy a průtoky – prototype

Map of Czech river gauges and reservoirs. River data come from the ČHMÚ open data
(`opendata.chmi.cz/hydrology`); reservoir data are scraped from the five povodí portals.

```
npm start        # http://localhost:8080
npm test         # offline tests
npm run build    # static site into site/ (what GitHub Pages serves)
```

Branch `pages` is the static version: a scheduled GitHub Action builds `data/*.json` every 30 minutes and deploys to GitHub Pages.
The flood experiment stays on `main`.

The first start takes ~15–90 s to fetch everything; the result is cached in `.cache/`, so later starts are instant.
See [CLAUDE.md](CLAUDE.md) for the code layout and gotchas.

**Status: prototype, unofficial.** Licensing and terms-of-use questions are open, see
[docs/licensing-and-terms.md](docs/licensing-and-terms.md) before sharing or publishing.
