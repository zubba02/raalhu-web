# Raalhu web

Interactive wave forecast site for the Maldives Experimental Wave Forecast System (MEWFS).
Static files only, made for GitHub Pages. No build step, no server, no paid services.

Live site: https://zubba02.github.io/raalhu-web/

## How it works

The model machine runs `export_web.py` (in the raalhu-model repo) after each SWAN run. It resamples
the day's `.vtu` output onto a regular grid and writes one small PNG per forecast hour into `data/`.
The page decodes those PNGs in the browser with WebGL, so visitors can pan, zoom, animate and tap
anywhere to read the values. A day of forecasts is about 3 MB.

```
index.html, about.html, css/, js/     the site (js/raalhu.js is the whole program)
data/index.js                         atolls and days available (written by the exporter)
data/<Atoll>/grid.js, depth.js        grid geometry, labels and bathymetry (written by the exporter)
data/<Atoll>/places.json              island labels and forecast points (edit by hand)
data/<Atoll>/<YYYYMMDD>/meta.js       run info, wind and swell forcing, point series
data/<Atoll>/<YYYYMMDD>/f000.js ...   hourly fields (a PNG packed in a .js file)
git_upload.sh                         commit + push, called by Initialize.py
tools/shrink_repo.sh                  reset git history when the repo gets big
```

## Things you may want to change

- **Island labels and forecast points**: edit `data/Laamu/places.json`. `places` are the names drawn
  on the map. `spots` are the points listed in the Places tab; give each a name and a lat/lon in open
  water and the next export picks them up.
- **Map detail**: `GRID_N` in `export_web.py` (default 640 pixels across the domain). Higher is
  sharper and larger.
- **Days kept online**: `KEEP_DAYS` in `export_web.py` (default 45).
- **A new atoll**: add it to `ATOLLS` in `export_web.py` and call `export_day(..., atoll="Name")`.
  It appears in the atoll menu automatically.

## Background map

The map behind the waves comes from free tile services that need no account: Esri World Imagery
(satellite) and OpenStreetMap (street map). Their credit line is shown on the map and must stay.
To change or add a source, edit `BASEMAPS` near the top of the map section in `js/raalhu.js`.
If the tiles cannot be reached, the site falls back to the plain land colour.

## Preview on your own computer

Double-click `index.html`. The data files are small scripts, so the page works straight from disk
as well as on GitHub Pages.

## Keeping the repository small

Git keeps every old forecast in its history even after the day folders are deleted, and GitHub asks
that repositories stay under about 1 GB. Run `bash tools/shrink_repo.sh` now and then (or set
`AUTO_SHRINK_MB` in `git_upload.sh`) to collapse the history into one commit. The live site is not
affected, but old commits are gone for good.

## Disclaimer

Experimental research product. Not for navigation or any safety-critical use.
