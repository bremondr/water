# European hydrology data sources

Researched 2026-11-11 by a subagent (~40 fetches). V = verified by a live call or fetched docs, I = inferred from snippets or background
knowledge. **Licences marked I must be read at the source before publishing anything.** Our builds run server-side in a GitHub Action, so CORS does
not matter. Reservoir-volume APIs: none found outside Czechia (the povodí scraping is the only precedent).

## Gauges

| Country / source | Endpoint, format | Update | Key | Licence / terms | Thresholds, coordinates, gauge zero | Status |
|---|---|---|---|---|---|---|
| UK (England), Environment Agency | `https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=level`, JSON | 15 min | no | OGL v3 (in every response) | coordinates, stageScale (typical range, highest recent) | V |
| Slovenia, ARSO | `https://www.arso.gov.si/xml/vode/hidro_podatki_zadnji.xml`, XML, 193 stations | 30 min | no | not stated in file, probably CC BY 4.0 (I), ask ARSO | coordinates, `kota_0` gauge zero, 3 flood discharge thresholds | V data, I licence |
| Germany, WSV Pegelonline | `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=ELBE&includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true`, JSON | 10-15 min | no | probably open with attribution to WSV (I); terms page not read | coordinates, river km, gaugeZero, HHW/NNW/MW; flood marks unclear. Includes Czech Elbe stations | V API, I licence |
| Poland, IMGW-PIB | `https://danepubliczne.imgw.pl/api/data/hydro`, JSON | ~1 h | no | free, attribution mandatory (§5), processed data must be labelled, **commercial use needs an agreement** (§3(2)) | coordinates, gauge zero, alarm and warning stage | V |
| Sweden, SMHI | `https://opendata-download-hydroobs.smhi.se/api/version/latest/parameter/1.json` | hourly/daily | no | CC BY 4.0 (I) | coordinates; no thresholds | V endpoint |
| Finland, SYKE | `https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.1/odata/Paikka`, OData | hourly/daily | no | CC BY 4.0 (I) | coordinates | V endpoint |
| Denmark | `https://vandah.miljoeportal.dk/api/stations` | 10-60 min | no | open (I) | coordinates | V endpoint |
| France, Hub'Eau | `https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr`, JSON | 5 min | no | Licence Ouverte 2.0 expected (I) | coordinates; thresholds live in Vigicrues, not Hub'Eau | V API |
| Switzerland, BAFU | official hydrodaten.admin.ch not verified; unofficial wrapper `https://api.existenz.ch/apiv1/hydro/latest` | 10 min | no | wrapper: free non-commercial, credit BAFU, no guarantee | no thresholds | V wrapper |
| Netherlands, Rijkswaterstaat | `https://waterwebservices.rijkswaterstaat.nl/` (JSON POST) | 10 min | no | "Publiek domein" (via search) | catalogue with coordinates | partly V |
| Norway, NVE | `https://hydapi.nve.no/` | 10 min | **API key** | NLOD / CC BY (I) | flood stages yes | V (401) |
| Austria, eHYD | `https://ehyd.gv.at/` bulk CSV, no real-time feed found | n/a | no | CC BY 4.0 (via INSPIRE snippet) | partly | partly V |
| Slovakia, SHMÚ | `opendata.shmu.sk` has **no hydrology** (weather/climate, CC BY 4.0); `hydro.shmu.sk` is HTML | n/a | | hydrology terms unknown | | V negative |
| Hungary | hydroinfo.hu HTML only, 2x daily; contact vizjelzes@vizugy.hu | | | no terms found | | V |
| Germany, Länder | per state (Sachsen LfULG, Bayern GKD CC BY 4.0 (I), BW HVZ); aggregator hochwasserzentralen.de | 15-60 min | varies | varies | Meldestufen often | I |
| Belgium, Croatia, Italy, Spain | not verified (Flanders returned 503); Italy and Spain fragmented per region | | | | | not researched |

Pan-European: EFAS/GloFAS and ECMWF need a Copernicus/CDS key; GRDC is a registered, non-commercial historical archive; WISE/EEA are
mostly water-body layers (CC BY 4.0 (I)); OpenStreetMap (ODbL) gives dam/weir geometry. All unverified except OSM.

## Flood zones and terrain (all inferred, none fetched)
Flood zones: Germany (state HQ100 maps), Austria (HORA), Poland (ISOK/KZGW WMS), UK (EA Flood Map, OGL), Netherlands (PDOK), Switzerland (BAFU),
France (Géorisques). Open LiDAR/DEM: Netherlands AHN (CC0), Poland GUGiK, Switzerland swissALTI3D, Austria ALS-DGM (CC BY), France IGN LiDAR HD,
England EA LiDAR (OGL), Slovenia ARSO LiDAR, Denmark DHM. Slovakia and Hungary less open.

## Ranking (ease x legal cleanness)
1. **UK (England)**: documented API, OGL v3 in every response, no key.
2. **Slovenia**: nearest to ČHMÚ (gauge zero, coordinates, three flood thresholds in one XML); only the licence statement is missing.
3. **Germany via Pegelonline**: best documented, includes the Czech Elbe; read the terms first.
4. **Poland**: alarm/warning stages and gauge zero in one JSON; attribution mandatory, commercial use needs an agreement.
5. **Sweden / Finland** (then Denmark): open JSON APIs, but no flood thresholds.

Not first targets: Slovakia (scrape-and-ask only), Hungary (HTML, unknown terms), Norway (key), Switzerland (only an unofficial wrapper), Austria (no real-time feed found), France (licence unread, thresholds elsewhere).

Before adding a country: add its attribution wording to the sources note in `index.html` and an item to the checklist in `licensing-and-terms.md`.
