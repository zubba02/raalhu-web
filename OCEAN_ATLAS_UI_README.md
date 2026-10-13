# Raalhu · Ocean Atlas UI v2

## What changed
A more distinctive, ocean-focused interface that puts the forecast map first. Reworked responsive masthead, map layers, helper cues, selected-location panel, metrics, charts, and timeline. The existing map, data parsing, forecast calculations, date selection, unit switching, theme switching, chart/table generation, exports, and canvas interactions are untouched.

Files updated/added:
- `index.html` – new presentational labels and layout details; existing control IDs preserved.
- `about.html` – unified branding and stylesheet reference.
- `css/atlas-ui.css` – entire responsive visual design layer, applied after `css/style.css`.

## Installation (changed-files ZIP)
Copy these files into the ROOT of the website GitHub repository, keeping the `css/` folder path. This version links `css/atlas-ui.css` from both HTML files. You can remove the previous `css/refined-ui.css` if it was installed; it is not used by this version.

## Installation (complete ZIP)
The full site ZIP includes the entire bundled website and all bundled original model/data files. Unzip the `raalhu-web-main` directory and use it as the repository root; GitHub Pages should load the `index.html` at the repository root. Do NOT nest that directory unless GitHub Pages is configured for it.

## What was tested
- Source JS passed `node --check`.
- Static responsive layout previews inspected at 1600x960, 1024x768, 820x1180, 390x844 and 340x700.
- No page-width horizontal overflow in those rendered previews.
- Checks were visual/layout checks using an illustrative static ocean map and historical sample values read from the supplied data. They are NOT verification of live forecast values, map shader rendering, model freshness, data interpolation, or physical-device behavior.
- `js/raalhu.js` and bundled model files are byte-for-byte unchanged compared with the uploaded copy.

## Safety
This is an experimental research forecast, not for navigation or any safety-critical marine decisions. Keep the existing disclaimer and authoritative national forecasts available.

## GitHub
No changes have been pushed to GitHub. Apply on a separate branch and review before deploying the live Pages site.
