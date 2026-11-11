// Česko: ČHMÚ open data (stations), the five povodí portals (reservoirs, weirs) and ČHMÚ long-term characteristics.
import { buildStations, buildReservoirs } from '../builders.mjs';
import { buildClimate } from '../climate.mjs';

export default {
  id: 'cz', name: 'Česko', center: [49.8, 15.5], zoom: 7,
  regionLabel: 'Povodí', allRegions: 'Všechna povodí',
  levels: {
    names: ['Bez povodňové aktivity', '1. SPA – bdělost', '2. SPA – pohotovost', '3. SPA – ohrožení', 'Extrémní povodeň'],
    short: ['Normální', '1. SPA', '2. SPA', '3. SPA', 'Extrém'],
  },
  source: 'ČHMÚ',
  about: `<p>Zdroje: ČHMÚ (<a href="https://opendata.chmi.cz/hydrology/">otevřená data</a>), webové portály Povodí Labe, Vltavy, Ohře, Odry a Moravy,
   OpenStreetMap, Wikipedie a Wikidata (polohy a seznam jezů).</p>`,
  sources: {
    stations: { ttlMin: 25, build: buildStations },
    reservoirs: { ttlMin: 55, build: buildReservoirs },
    climate: { ttlMin: 7 * 24 * 60, build: buildClimate },
  },
};
