# Seoul Live City Lens

Interactive Seoul city explorer for live place-based public signals.

The application combines:
- an always-on Seoul crowd heatmap
- a draggable magnifier lens
- multi-signal place inspection for `Crowd`, `Transit`, `Traffic`, and `Weather`
- a Seoul-only constrained map with outside-city masking

Built with `MapLibre + TypeScript + Vite`, the project is designed as a map-first interface for exploring live conditions across Seoul’s curated realtime hotspots.

## Project Overview

The lens can be moved over Seoul to inspect the nearest live hotspot and summarize nearby signals inside a configurable focus radius.

Core capabilities:
- read crowd intensity directly from the map heat layer
- inspect a focused place through the magnifier lens
- adjust the local aggregation radius
- compare multiple signal categories at the same focused location

## Current Scope

The current implementation includes:
- Seoul-only basemap framing
- masked outside-city area
- live hotspot-based crowd heat
- circular focus radius on the map
- magnified inset map inside the lens
- 4 signal summary cards around the lens
- separate `Focus Place` summary card
- responsive controls for desktop, tablet, and mobile

## Data Sources

### Live hotspot snapshot
- File: [public/data/seoul-lens-data.json](/data/omar/RESEARCH/lill_project/public/data/seoul-lens-data.json)
- Generated from Seoul public realtime endpoints
- Includes `121` live places

Per hotspot the dataset stores:
- place name
- category
- latitude / longitude
- crowd level
- transit metrics
- traffic metrics
- weather metrics

### Seoul city boundary
- File: [public/data/seoul-boundary.geojson](/data/omar/RESEARCH/lill_project/public/data/seoul-boundary.geojson)
- Used for:
  - Seoul-only masking
  - map bounds
  - lens placement validation

### Hotspot polygon layer
- File: [public/data/seoul-121-areas.geojson](/data/omar/RESEARCH/lill_project/public/data/seoul-121-areas.geojson)
- Preserved for reference and joins
- Not rendered in the final UI

## Data Pull Scripts

### Pull live hotspot lens data
```bash
npm run pull:seoul-lens
```

Script:
- [scripts/pull-seoul-lens-data.mjs](/data/omar/RESEARCH/lill_project/scripts/pull-seoul-lens-data.mjs)

What it does:
- opens the public Seoul realtime service session
- requests hotspot-level data from the public frontend endpoints
- normalizes the response into one cached client-side JSON file
- keeps only the fields required by the lens UI

Pulled metrics include:
- crowd level and short-term crowd indicators
- transit ride / alight / balance values
- road speed and parking values
- weather and air-quality values

Output:
- [public/data/seoul-lens-data.json](/data/omar/RESEARCH/lill_project/public/data/seoul-lens-data.json)

### Pull Seoul boundary
```bash
npm run pull:seoul-boundary
```

Script:
- [scripts/pull-seoul-boundary.mjs](/data/omar/RESEARCH/lill_project/scripts/pull-seoul-boundary.mjs)

What it does:
- requests the Seoul administrative boundary as GeoJSON
- writes a simplified local boundary file used by the app for masking and bounds

Output:
- [public/data/seoul-boundary.geojson](/data/omar/RESEARCH/lill_project/public/data/seoul-boundary.geojson)

## Deployment Refresh Model

The recommended GitHub deployment model is:
- keep the application code and the current snapshot in the repository
- rebuild the site on a GitHub Actions schedule
- pull a fresh live snapshot during the scheduled build
- deploy the generated `dist/` output directly to GitHub Pages

This avoids writing a new data snapshot into Git history every few minutes.

Current automation behavior:
- `push` to `main` or `master` builds and deploys the current repo state
- `schedule` every 5 minutes pulls a fresh Seoul snapshot, rebuilds, and deploys
- the browser checks for a newer deployed snapshot every 1 minute

## Tech Stack

- `Vite`
- `TypeScript`
- `MapLibre GL JS`
- browser-rendered HTML/CSS UI

Package manifest:
- [package.json](/data/omar/RESEARCH/lill_project/package.json)

## Project Structure

- [src/main.ts](/data/omar/RESEARCH/lill_project/src/main.ts)
  App entrypoint
- [src/dashboard.ts](/data/omar/RESEARCH/lill_project/src/dashboard.ts)
  Main map, lens, state, data joins, and interaction logic
- [src/style.css](/data/omar/RESEARCH/lill_project/src/style.css)
  Full visual system, motion, responsive layout, and overlay styling
- [public/data/seoul-lens-data.json](/data/omar/RESEARCH/lill_project/public/data/seoul-lens-data.json)
  Cached live hotspot snapshot
- [public/data/seoul-boundary.geojson](/data/omar/RESEARCH/lill_project/public/data/seoul-boundary.geojson)
  Seoul boundary
- [public/data/seoul-121-areas.geojson](/data/omar/RESEARCH/lill_project/public/data/seoul-121-areas.geojson)
  Original hotspot area polygons

## How It Works

### 1. Main map and lens map

The app creates two `MapLibre` maps:
- `mainMap`
- `lensMap`

`mainMap` is the actual Seoul map.

`lensMap` is rendered inside the circular lens and is synchronized to the lens center with a slightly higher zoom. This is what creates the magnifier effect.

### 2. Seoul-only masking

The Seoul boundary is loaded as GeoJSON and used in 3 ways:
- draw a city outline
- set the map max bounds
- create a world polygon with the Seoul boundary cut out as a hole, then fill the outside area

This keeps the experience visually focused on Seoul without drawing the original hotspot polygons.

### 3. Lens placement

The lens is positioned in screen coordinates.

When the lens moves:
- the screen center of the magnifier is converted into map coordinates with `unproject(...)`
- lens movement is rejected if the pointer would place the focus outside Seoul
- the focus radius circle is regenerated as GeoJSON

The lens overlay is aligned from the actual magnifier frame center, not a hardcoded approximation.

### 4. Focus selection

For each lens position:
- all hotspots are distance-sorted from the lens center
- hotspots inside the selected radius are collected
- if none fall inside the radius, the app falls back to the nearest small set

The nearest hotspot becomes the `Focus Place`.

### 5. Signal summaries

The focused and nearby hotspots are summarized into 4 cards:

#### Crowd
- current crowd state
- nearby elevated places
- visitor share
- 1 hour delta

#### Transit
- movers in 30 minutes
- rides
- exits
- flow / nearby balance

#### Traffic
- average speed
- parking availability
- slow links at place
- nearby slow links

#### Weather
- temperature
- rain chance
- PM10 / PM2.5 context
- nearby average weather

### 6. Crowd heatmap

The heatmap is always visible.

Each hotspot gets:
- a `weight`
- a stronger `heatWeight`

The app maps crowd levels to stronger visual heat so busy places read faster on the map.

The heatmap uses tuned values for:
- `heatmap-weight`
- `heatmap-intensity`
- `heatmap-radius`
- `heatmap-opacity`
- `heatmap-color`

A small legend is rendered on larger screens to explain `Easy`, `Moderate`, and `Busy`.

## Interface Overview

The interface is divided into 4 main pieces:
- a constrained Seoul basemap
- a lens overlay for focused inspection
- signal cards for the selected live categories
- a control area for category toggles and focus radius

The `Focus Place` card is separated from the main control stack so the current place summary remains visible more reliably across viewport sizes.

## Responsive Behavior

The app has dedicated layout handling for:
- desktop
- tablet
- mobile
- short-height screens

Current responsive rules are primarily in:
- [src/style.css](/data/omar/RESEARCH/lill_project/src/style.css)

Key responsive decisions:
- compact control layout on smaller viewports
- reduced lens and signal-card sizing on narrow screens
- height-based compaction on shorter screens
- crowd legend hidden when it becomes visual clutter

## Commands

Install dependencies:
```bash
npm install
```

Run dev server:
```bash
npm run dev
```

Build production bundle:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Build Status

The app currently builds successfully with:
```bash
npm run build
```

## Notes

- The live place dataset is a cached public snapshot, not a websocket stream.
- The app is strongest for curated Seoul hotspots rather than continuous parcel-level live coverage.
- The product model is intentionally map-first rather than chart-dashboard-first.

## Next Good Improvements

- smarter auto-layout for the 4 signal cards to avoid overlaps more dynamically
- time snapshot history and compare mode
- richer crowd legend / threshold explanation
- optional layer legend for transit and traffic density
- real polling or scheduled refresh of the cached live snapshot
