import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

type LensMode = 'crowd' | 'transit' | 'traffic' | 'weather'

interface LensDataset {
  generatedAt: string
  hotspots: Hotspot[]
}

interface SeoulBoundaryCollection extends GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {}

interface Hotspot {
  name: string
  category: string
  lat: number
  lng: number
  crowd: {
    level: string
    levelNum: number | null
    oneHourRate: number | null
    threeHourRate: number | null
    residentShare: number | null
    nonResidentShare: number | null
    dominantAgeLabel: string | null
    dominantAgeShare: number | null
  }
  transit: {
    rideCount: number | null
    alightCount: number | null
    balance: number | null
    flow: string | null
  }
  traffic: {
    avgRoadSpeed: number | null
    slowRoadSegments: number
    roadSegments: number
    parkingCapacity: number | null
    parkingAvailable: number | null
    parkingAvailabilityRate: number | null
  }
  weather: {
    temperature: number | null
    feelsLike: number | null
    rainChance: number | null
    pm10: number | null
    pm25: number | null
    uvLabel: string | null
    airLabel: string | null
  }
}

interface DashboardController {
  destroy(): void
}

interface FocusSelection {
  anchor: Hotspot
  hotspots: Hotspot[]
  fallback: boolean
  center: { lng: number; lat: number }
  distanceMeters: number
}

interface SignalCard {
  mode: LensMode
  primary: string
  secondary: string
  meta: string
  strength: number
}

interface GeoBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const DEFAULT_CENTER: [number, number] = [126.9784, 37.5665]
const HOTSPOT_SOURCE_ID = 'live-hotspots'
const SEOUL_BOUNDARY_SOURCE_ID = 'seoul-boundary'
const SEOUL_MASK_SOURCE_ID = 'seoul-mask'
const FOCUS_SOURCE_ID = 'focus-area'
const DEFAULT_ACTIVE_MODES: LensMode[] = ['crowd', 'transit', 'traffic', 'weather']
const DATA_REFRESH_INTERVAL_MS = 60 * 1000
const WORLD_RING: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
]

const MODE_META: Record<
  LensMode,
  {
    label: string
    accent: string
    soft: string
    description: string
    short: string
  }
> = {
  crowd: {
    label: 'Crowd',
    accent: '#f06e1d',
    soft: 'rgba(240, 110, 29, 0.16)',
    description: 'Live crowd intensity and nearby congestion.',
    short: 'CR',
  },
  transit: {
    label: 'Transit',
    accent: '#8257ff',
    soft: 'rgba(130, 87, 255, 0.16)',
    description: 'Ride, alight, and balance nearby.',
    short: 'TR',
  },
  traffic: {
    label: 'Traffic',
    accent: '#0f9f8c',
    soft: 'rgba(15, 159, 140, 0.16)',
    description: 'Road speed and parking nearby.',
    short: 'TF',
  },
  weather: {
    label: 'Weather',
    accent: '#2f7dff',
    soft: 'rgba(47, 125, 255, 0.16)',
    description: 'Temperature, rain, and air quality.',
    short: 'WT',
  },
}

const CROWD_LEVEL_LABELS: Record<string, string> = {
  여유: 'Easy',
  보통: 'Moderate',
  '약간 붐빔': 'Busy',
  붐빔: 'Very Busy',
  '매우 붐빔': 'Packed',
}

export function createDashboard(root: HTMLElement): DashboardController {
  root.innerHTML = `
    <div class="lens-page">
      <div class="map-stage">
        <div id="main-map" class="map-canvas"></div>
        <div class="map-wash"></div>
        <div id="dock-backdrop" class="dock-backdrop"></div>
        <button id="dock-toggle" class="dock-toggle" type="button" aria-expanded="false" aria-controls="side-dock">
          Signals
        </button>

        <aside id="side-dock" class="side-dock">
          <div class="dock-head">
            <div class="dock-badge">Seoul Lens</div>
            <button id="dock-fold" class="dock-fold" type="button" aria-controls="side-dock" aria-label="Fold panel">
              Hide
            </button>
          </div>
          <h1>Seoul, focused.</h1>
          <p class="dock-copy">
            Live crowd heat with transit, traffic, and weather around one place.
          </p>
          <div class="dock-note">Seoul-only · drag lens</div>

          <div class="mode-label">Signals</div>
          <div class="mode-stack">
            ${Object.entries(MODE_META)
              .map(
                ([mode, meta]) => `
                  <button
                    class="mode-card is-active"
                    type="button"
                    data-mode="${mode}"
                    aria-pressed="true"
                    style="--mode-accent:${meta.accent}; --mode-soft:${meta.soft};"
                  >
                    <span class="mode-mark">${meta.short}</span>
                    <span class="mode-copy">
                      <strong>${meta.label}</strong>
                      <span>${meta.description}</span>
                    </span>
                    <span class="mode-check">On</span>
                  </button>
                `,
              )
              .join('')}
          </div>
        </aside>

        <section id="focus-pod" class="focus-pod">
          <div class="focus-card">
            <span class="focus-label">Focus Place</span>
            <strong id="focus-name">Preparing Seoul</strong>
            <span id="focus-meta" class="focus-meta">Loading live hotspot signals.</span>
          </div>
        </section>

        <div id="empty-state" class="empty-state hidden">Lens data unavailable.</div>

        <div id="lens-root" class="lens-root">
          <div id="signal-orbit" class="signal-orbit"></div>
          <div id="lens-frame" class="lens-frame" role="button" tabindex="0" aria-label="Drag lens over Seoul">
            <div id="lens-map" class="lens-map"></div>
            <div class="lens-glass"></div>
            <div class="lens-ring"></div>
            <div class="lens-core">
              <span id="lens-kicker" class="lens-kicker">Focused place</span>
              <strong id="lens-primary" class="lens-primary">Preparing Seoul</strong>
              <span id="lens-secondary" class="lens-secondary">Loading live public signals.</span>
            </div>
          </div>
        </div>

        <section class="radius-panel">
          <div class="radius-copy">
            <span class="radius-label">Focus Radius</span>
            <strong id="radius-value">4.2 km</strong>
          </div>
          <input id="radius-input" class="radius-input" type="range" min="1800" max="9000" step="200" value="4200" />
        </section>

        <section class="crowd-legend" aria-label="Crowd heat legend">
          <span class="crowd-legend__label">Crowd Heat</span>
          <span class="crowd-legend__item"><i class="crowd-legend__dot crowd-legend__dot--easy"></i>Easy</span>
          <span class="crowd-legend__item"><i class="crowd-legend__dot crowd-legend__dot--moderate"></i>Moderate</span>
          <span class="crowd-legend__item"><i class="crowd-legend__dot crowd-legend__dot--busy"></i>Busy</span>
        </section>

        <div class="footer-note">
          <span id="status-line">Loading Seoul live snapshot…</span>
        </div>
      </div>
    </div>
  `

  const elements = {
    stage: root.querySelector<HTMLElement>('.map-stage')!,
    mainMap: getById<HTMLDivElement>(root, 'main-map'),
    lensMap: getById<HTMLDivElement>(root, 'lens-map'),
    lensRoot: getById<HTMLDivElement>(root, 'lens-root'),
    lensFrame: getById<HTMLDivElement>(root, 'lens-frame'),
    sideDock: getById<HTMLElement>(root, 'side-dock'),
    dockToggle: getById<HTMLButtonElement>(root, 'dock-toggle'),
    dockFold: getById<HTMLButtonElement>(root, 'dock-fold'),
    dockBackdrop: getById<HTMLDivElement>(root, 'dock-backdrop'),
    lensKicker: getById<HTMLElement>(root, 'lens-kicker'),
    lensPrimary: getById<HTMLElement>(root, 'lens-primary'),
    lensSecondary: getById<HTMLElement>(root, 'lens-secondary'),
    focusName: getById<HTMLElement>(root, 'focus-name'),
    focusMeta: getById<HTMLElement>(root, 'focus-meta'),
    signalOrbit: getById<HTMLDivElement>(root, 'signal-orbit'),
    radiusInput: getById<HTMLInputElement>(root, 'radius-input'),
    radiusValue: getById<HTMLElement>(root, 'radius-value'),
    statusLine: getById<HTMLElement>(root, 'status-line'),
    modeButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mode]')),
    emptyState: getById<HTMLElement>(root, 'empty-state'),
  }

  const state: {
    dataset: LensDataset | null
    boundary: SeoulBoundaryCollection | null
    activeModes: LensMode[]
    radiusMeters: number
    lensX: number
    lensY: number
    dockOpen: boolean
    compactDock: boolean
    dragged: boolean
    dragging: boolean
  } = {
    dataset: null,
    boundary: null,
    activeModes: [...DEFAULT_ACTIVE_MODES],
    radiusMeters: 4200,
    lensX: 0,
    lensY: 0,
    dockOpen: true,
    compactDock: false,
    dragged: false,
    dragging: false,
  }

  const mainMap = new maplibregl.Map({
    container: elements.mainMap,
    style: BASEMAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: 11.65,
    minZoom: 10.9,
    maxZoom: 16,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    cooperativeGestures: true,
    renderWorldCopies: false,
  })

  const lensMap = new maplibregl.Map({
    container: elements.lensMap,
    style: BASEMAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: 13,
    minZoom: 10.9,
    maxZoom: 17.2,
    interactive: false,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: false,
  })

  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  mainMap.getCanvas().style.cursor = 'crosshair'

  const resizeObserver = new ResizeObserver(() => {
    mainMap.resize()
    lensMap.resize()

    if (!state.dragged) {
      const bounds = elements.mainMap.getBoundingClientRect()
      state.lensX = bounds.width * 0.62
      state.lensY = bounds.height * 0.58
    } else {
      clampLensToStage()
    }

    render()
  })

  resizeObserver.observe(elements.mainMap)

  let windowMoveHandler: ((event: PointerEvent) => void) | null = null
  let windowUpHandler: (() => void) | null = null
  let bootCancelled = false
  let refreshIntervalId: number | null = null
  const compactDockQuery = window.matchMedia('(max-width: 1080px)')

  const compactDockListener = () => {
    state.compactDock = compactDockQuery.matches
    state.dockOpen = !state.compactDock
    syncDockState()
    clampLensToStage()
    render()
  }

  compactDockQuery.addEventListener('change', compactDockListener)
  compactDockListener()

  elements.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as LensMode
      const next = state.activeModes.includes(mode)
        ? state.activeModes.filter((item) => item !== mode)
        : [...state.activeModes, mode]

      if (next.length === 0) {
        return
      }

      state.activeModes = next
      syncModes()
      render()
    })
  })

  elements.radiusInput.addEventListener('input', () => {
    state.radiusMeters = Number(elements.radiusInput.value)
    render()
  })

  elements.dockToggle.addEventListener('click', () => {
    state.dockOpen = !state.dockOpen
    syncDockState()
  })

  elements.dockFold.addEventListener('click', () => {
    state.dockOpen = false
    syncDockState()
  })

  elements.dockBackdrop.addEventListener('click', () => {
    if (!state.compactDock) {
      return
    }

    state.dockOpen = false
    syncDockState()
  })

  elements.lensFrame.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()

    state.dragging = true
    state.dragged = true
    elements.lensRoot.classList.add('is-dragging')
    mainMap.dragPan.disable()

    const stageBounds = elements.mainMap.getBoundingClientRect()
    const offsetX = event.clientX - stageBounds.left - state.lensX
    const offsetY = event.clientY - stageBounds.top - state.lensY

    windowMoveHandler = (moveEvent: PointerEvent) => {
      const nextX = moveEvent.clientX - stageBounds.left - offsetX
      const nextY = moveEvent.clientY - stageBounds.top - offsetY

      if (!canPlaceLens(nextX, nextY)) {
        return
      }

      state.lensX = nextX
      state.lensY = nextY
      clampLensToStage()
      render()
    }

    windowUpHandler = () => {
      state.dragging = false
      elements.lensRoot.classList.remove('is-dragging')
      mainMap.dragPan.enable()

      if (windowMoveHandler) {
        window.removeEventListener('pointermove', windowMoveHandler)
      }
      if (windowUpHandler) {
        window.removeEventListener('pointerup', windowUpHandler)
      }

      windowMoveHandler = null
      windowUpHandler = null
    }

    window.addEventListener('pointermove', windowMoveHandler)
    window.addEventListener('pointerup', windowUpHandler)
  })

  const bootPromise = Promise.all([waitForMap(mainMap), waitForMap(lensMap), loadDataset(), loadBoundary()])
    .then(([, , dataset, boundary]) => {
      if (bootCancelled) {
        return
      }

      state.dataset = dataset
      state.boundary = boundary
      elements.statusLine.textContent = formatStatusLine(dataset)

      const hotspotSource = buildPointCollection(dataset.hotspots)
      const maskSource = buildBoundaryMask(boundary)

      setupMap(mainMap, hotspotSource, boundary, maskSource, true)
      setupMap(lensMap, hotspotSource, boundary, maskSource, false)
      constrainMapToSeoul(mainMap, boundary, true)
      constrainMapToSeoul(lensMap, boundary, false)
      startAutoRefresh()

      const bounds = elements.mainMap.getBoundingClientRect()
      state.lensX = bounds.width * 0.62
      state.lensY = bounds.height * 0.58

      syncModes()
      render()
    })
    .catch((error) => {
      elements.emptyState.classList.remove('hidden')
      elements.statusLine.textContent =
        error instanceof Error ? error.message : 'Unable to load the Seoul lens dataset.'
    })

  mainMap.on('move', () => {
    if (state.dataset) {
      render()
    }
  })

  mainMap.on('click', (event) => {
    if (!state.dataset || !canPlaceLens(event.point.x, event.point.y)) {
      return
    }

    if (state.compactDock && state.dockOpen) {
      state.dockOpen = false
      syncDockState()
    }

    state.dragged = true
    state.lensX = event.point.x
    state.lensY = event.point.y
    clampLensToStage()
    render()
  })

  return {
    destroy() {
      bootCancelled = true
      resizeObserver.disconnect()

      if (windowMoveHandler) {
        window.removeEventListener('pointermove', windowMoveHandler)
      }
      if (windowUpHandler) {
        window.removeEventListener('pointerup', windowUpHandler)
      }
      compactDockQuery.removeEventListener('change', compactDockListener)
      if (refreshIntervalId !== null) {
        window.clearInterval(refreshIntervalId)
      }

      mainMap.remove()
      lensMap.remove()
      void bootPromise
    },
  }

  function syncModes() {
    elements.modeButtons.forEach((button) => {
      const mode = button.dataset.mode as LensMode
      const active = state.activeModes.includes(mode)
      const check = button.querySelector<HTMLElement>('.mode-check')

      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))

      if (check) {
        check.textContent = active ? 'On' : 'Off'
      }
    })
  }

  function syncDockState() {
    elements.stage.classList.toggle('is-compact-dock', state.compactDock)
    elements.stage.classList.toggle('is-dock-open', state.dockOpen)
    elements.dockToggle.setAttribute('aria-expanded', String(state.dockOpen))
    elements.dockToggle.textContent = state.compactDock ? (state.dockOpen ? 'Close' : 'Signals') : 'Panel'
  }

  function render() {
    if (!state.dataset) {
      return
    }

    clampLensToStage()
    positionLens()

    const center = mainMap.unproject([state.lensX, state.lensY])
    const focus = getFocusSelection(center)
    const signalCards = buildSignalCards(focus).filter((card) => state.activeModes.includes(card.mode))

    elements.radiusValue.textContent = formatDistance(state.radiusMeters)
    elements.lensKicker.textContent = focus.fallback ? 'Nearest live place' : 'Focused live place'
    elements.lensPrimary.textContent = normalizePlaceName(focus.anchor.name)
    elements.lensSecondary.textContent =
      `${focus.anchor.category} · ${formatCrowdLevel(focus.anchor.crowd.level)} crowd · ${focus.hotspots.length} live places in ${formatDistance(state.radiusMeters)}`

    elements.focusName.textContent = normalizePlaceName(focus.anchor.name)
    elements.focusMeta.textContent =
      `${formatDistanceLabel(focus.distanceMeters)} · ${focus.anchor.category} · ${formatCrowdLevel(focus.anchor.crowd.level)} crowd`

    renderSignalCards(signalCards)
    syncFocusCircle(center)
    syncLensMap(center)
  }

  function positionLens() {
    const { centerX, centerY } = getLensAnchor()
    elements.lensRoot.style.transform = `translate(${state.lensX - centerX}px, ${state.lensY - centerY}px)`
  }

  function clampLensToStage() {
    const bounds = elements.mainMap.getBoundingClientRect()
    const leftPadding = window.innerWidth > 1080 ? 390 : 130
    const rightPadding = 160
    const topPadding = window.innerWidth > 1080 ? 160 : 130
    const bottomPadding = 170

    state.lensX = clamp(state.lensX || bounds.width * 0.62, leftPadding, Math.max(leftPadding, bounds.width - rightPadding))
    state.lensY = clamp(state.lensY || bounds.height * 0.58, topPadding, Math.max(topPadding, bounds.height - bottomPadding))
  }

  function getLensAnchor() {
    return {
      centerX: elements.lensFrame.offsetLeft + elements.lensFrame.offsetWidth / 2,
      centerY: elements.lensFrame.offsetTop + elements.lensFrame.offsetHeight / 2,
    }
  }

  function canPlaceLens(x: number, y: number) {
    if (!state.boundary) {
      return true
    }

    const previewX = clamp(x, 0, elements.mainMap.clientWidth)
    const previewY = clamp(y, 0, elements.mainMap.clientHeight)
    const point = mainMap.unproject([previewX, previewY])

    return pointInGeometry(point.lng, point.lat, state.boundary.features[0].geometry)
  }

  function getFocusSelection(center: maplibregl.LngLat): FocusSelection {
    const distances = state.dataset!.hotspots
      .map((hotspot) => ({
        hotspot,
        distance: haversineMeters(center.lng, center.lat, hotspot.lng, hotspot.lat),
      }))
      .sort((left, right) => left.distance - right.distance)

    const nearby = distances.filter((item) => item.distance <= state.radiusMeters).map((item) => item.hotspot)
    const anchor = distances[0].hotspot
    const fallback = nearby.length === 0

    return {
      anchor,
      hotspots: fallback ? distances.slice(0, 6).map((item) => item.hotspot) : nearby,
      fallback,
      center: { lng: center.lng, lat: center.lat },
      distanceMeters: distances[0].distance,
    }
  }

  function syncLensMap(center: maplibregl.LngLat) {
    lensMap.jumpTo({
      center: [center.lng, center.lat],
      zoom: Math.max(mainMap.getZoom() + 1.2, 13.1),
      bearing: mainMap.getBearing(),
      pitch: 0,
    })
  }

  function syncFocusCircle(center: maplibregl.LngLat) {
    const source = mainMap.getSource(FOCUS_SOURCE_ID) as GeoJSONSource | undefined

    if (!source) {
      return
    }

    source.setData(buildCircleFeature(center, state.radiusMeters))
  }

  function renderSignalCards(cards: SignalCard[]) {
    elements.signalOrbit.innerHTML = cards
      .map((card) => {
        const meta = MODE_META[card.mode]

        return `
          <article
            class="signal-card signal-card--${card.mode}"
            style="--card-accent:${meta.accent}; --card-soft:${meta.soft}; --card-strength:${card.strength.toFixed(3)};"
          >
            <span class="signal-tag">${meta.label}</span>
            <strong>${escapeHtml(card.primary)}</strong>
            <p>${escapeHtml(card.secondary)}</p>
            <span class="signal-meta">${escapeHtml(card.meta)}</span>
          </article>
        `
      })
      .join('')
  }

  function startAutoRefresh() {
    if (refreshIntervalId !== null) {
      window.clearInterval(refreshIntervalId)
    }

    refreshIntervalId = window.setInterval(async () => {
      if (!state.dataset) {
        return
      }

      try {
        const nextDataset = await loadDataset(true)

        if (nextDataset.generatedAt === state.dataset.generatedAt) {
          return
        }

        state.dataset = nextDataset
        updateHotspotSources(nextDataset.hotspots)
        elements.statusLine.textContent = formatStatusLine(nextDataset, 'Auto-updated')
        render()
      } catch (error) {
        console.error('Auto-refresh failed', error)
      }
    }, DATA_REFRESH_INTERVAL_MS)
  }

  function updateHotspotSources(hotspots: Hotspot[]) {
    const nextData = buildPointCollection(hotspots)
    const mainSource = mainMap.getSource(HOTSPOT_SOURCE_ID) as GeoJSONSource | undefined
    const lensSource = lensMap.getSource(HOTSPOT_SOURCE_ID) as GeoJSONSource | undefined

    mainSource?.setData(nextData)
    lensSource?.setData(nextData)
  }
}

function setupMap(
  map: MapLibreMap,
  hotspotData: GeoJSON.FeatureCollection<GeoJSON.Point>,
  boundary: SeoulBoundaryCollection,
  mask: GeoJSON.FeatureCollection<GeoJSON.Polygon>,
  includeFocusCircle: boolean,
) {
  map.addSource(SEOUL_MASK_SOURCE_ID, {
    type: 'geojson',
    data: mask,
  })

  map.addLayer({
    id: `${SEOUL_MASK_SOURCE_ID}-fill`,
    type: 'fill',
    source: SEOUL_MASK_SOURCE_ID,
    paint: {
      'fill-color': includeFocusCircle ? 'rgba(242, 239, 232, 0.92)' : 'rgba(250, 247, 242, 0.82)',
      'fill-opacity': includeFocusCircle ? 0.9 : 0.78,
    },
  })

  map.addSource(SEOUL_BOUNDARY_SOURCE_ID, {
    type: 'geojson',
    data: boundary,
  })

  map.addSource(HOTSPOT_SOURCE_ID, {
    type: 'geojson',
    data: hotspotData,
  })

  map.addLayer({
    id: `${HOTSPOT_SOURCE_ID}-heat`,
    type: 'heatmap',
    source: HOTSPOT_SOURCE_ID,
    maxzoom: 15.8,
    paint: {
      'heatmap-weight': [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'heatWeight'], 0.18],
        0.18,
        0.16,
        1.35,
        0.92,
        2.5,
        1.65,
      ],
      'heatmap-intensity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10.5,
        1.28,
        12.2,
        1.85,
        15.5,
        2.35,
      ],
      'heatmap-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10.5,
        38,
        12.5,
        64,
        15.5,
        92,
      ],
      'heatmap-opacity': includeFocusCircle ? 0.94 : 0.84,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(255,255,255,0)',
        0.12,
        'rgba(255, 214, 171, 0.2)',
        0.24,
        'rgba(255, 175, 104, 0.42)',
        0.42,
        'rgba(247, 129, 48, 0.72)',
        0.62,
        'rgba(238, 85, 29, 0.86)',
        0.82,
        'rgba(204, 36, 22, 0.94)',
        1,
        'rgba(112, 7, 12, 0.99)',
      ],
    },
  })

  map.addLayer({
    id: `${HOTSPOT_SOURCE_ID}-points`,
    type: 'circle',
    source: HOTSPOT_SOURCE_ID,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10.5,
        2.5,
        12.5,
        4.5,
        15.5,
        7,
      ],
      'circle-color': [
        'match',
        ['coalesce', ['get', 'weight'], 1],
        3,
        '#d6401e',
        2,
        '#f08e2f',
        '#ffd1a4',
      ],
      'circle-opacity': includeFocusCircle ? 0 : 0.15,
      'circle-stroke-width': 0,
    },
  })

  map.addLayer({
    id: `${SEOUL_BOUNDARY_SOURCE_ID}-line`,
    type: 'line',
    source: SEOUL_BOUNDARY_SOURCE_ID,
    paint: {
      'line-color': '#2a0819',
      'line-width': includeFocusCircle ? 2.1 : 1.4,
      'line-opacity': includeFocusCircle ? 0.4 : 0.24,
    },
  })

  if (includeFocusCircle) {
    map.addSource(FOCUS_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    })

    map.addLayer({
      id: `${FOCUS_SOURCE_ID}-fill`,
      type: 'fill',
      source: FOCUS_SOURCE_ID,
      paint: {
        'fill-color': '#2a0819',
        'fill-opacity': 0.035,
      },
    })

    map.addLayer({
      id: `${FOCUS_SOURCE_ID}-line`,
      type: 'line',
      source: FOCUS_SOURCE_ID,
      paint: {
        'line-color': '#2a0819',
        'line-width': 2.2,
        'line-opacity': 0.34,
        'line-dasharray': [2, 2],
      },
    })
  }
}

function constrainMapToSeoul(map: MapLibreMap, boundary: SeoulBoundaryCollection, fitView: boolean) {
  const geometry = boundary.features[0]?.geometry

  if (!geometry) {
    return
  }

  const bounds = getGeometryBounds(geometry)
  const expanded: [[number, number], [number, number]] = [
    [bounds.minLng - 0.018, bounds.minLat - 0.012],
    [bounds.maxLng + 0.018, bounds.maxLat + 0.012],
  ]

  map.setMaxBounds(expanded)

  if (fitView) {
    map.fitBounds(expanded, {
      padding: resolveViewportPadding(window.innerWidth),
      duration: 0,
    })

    map.setMinZoom(Math.max(11.25, map.getZoom() - 0.12))
  }
}

function buildSignalCards(focus: FocusSelection): SignalCard[] {
  const anchor = focus.anchor
  const nearby = focus.hotspots
  const nearbyElevated = nearby.filter((item) => (item.crowd.levelNum ?? 0) >= 2).length
  const nearbyVisitors = average(nearby.map((item) => item.crowd.nonResidentShare))
  const nearbyBalance = sum(nearby.map((item) => item.transit.balance))
  const nearbySlowRoads = sum(nearby.map((item) => item.traffic.slowRoadSegments))
  const nearbyAvgTemp = average(nearby.map((item) => item.weather.temperature))

  const ride = anchor.transit.rideCount
  const alight = anchor.transit.alightCount
  const movers = ride === null && alight === null ? null : (ride ?? 0) + (alight ?? 0)

  return [
    {
      mode: 'crowd',
      primary: formatCrowdLevel(anchor.crowd.level),
      secondary: `${nearbyElevated}/${nearby.length} nearby elevated · visitors ${formatPercent(nearbyVisitors)}`,
      meta: `1h ${formatSignedPercent(anchor.crowd.oneHourRate)} · level ${anchor.crowd.levelNum ?? '—'}/3`,
      strength: normalize(anchor.crowd.levelNum ?? 1, 3),
    },
    {
      mode: 'transit',
      primary: movers === null ? 'Live unavailable' : `${formatCompact(movers)} movers`,
      secondary: `${formatCompactNullable(ride)} rides · ${formatCompactNullable(alight)} exits`,
      meta: `${anchor.transit.flow ?? 'Live flow'} · nearby ${formatSignedCompact(nearbyBalance)}`,
      strength: normalizeRoot(movers ?? 0, 6000),
    },
    {
      mode: 'traffic',
      primary: formatSpeed(anchor.traffic.avgRoadSpeed),
      secondary: `${formatCompactNullable(anchor.traffic.parkingAvailable)} open spaces · ${formatPercent(anchor.traffic.parkingAvailabilityRate)}`,
      meta: `${anchor.traffic.slowRoadSegments} slow links here · ${nearbySlowRoads} nearby`,
      strength: normalize(anchor.traffic.roadSegments, 120),
    },
    {
      mode: 'weather',
      primary: formatTemperature(anchor.weather.temperature),
      secondary: `rain ${formatPercent(anchor.weather.rainChance)} · PM10 ${formatNullable(anchor.weather.pm10, 0)}`,
      meta: `${anchor.weather.airLabel ?? 'Live air'} · lens avg ${formatTemperature(nearbyAvgTemp)}`,
      strength: normalize((anchor.weather.rainChance ?? 0) + (anchor.weather.pm25 ?? 0), 140),
    },
  ]
}

function buildPointCollection(hotspots: Hotspot[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: hotspots.map((hotspot) => ({
      type: 'Feature',
      properties: {
        name: hotspot.name,
        category: hotspot.category,
        weight: hotspot.crowd.levelNum ?? 1,
        heatWeight:
          hotspot.crowd.levelNum === 3
            ? 2.5
            : hotspot.crowd.levelNum === 2
              ? 1.35
              : hotspot.crowd.levelNum === 1
                ? 0.24
                : 0.18,
      },
      geometry: {
        type: 'Point',
        coordinates: [hotspot.lng, hotspot.lat],
      },
    })),
  }
}

function buildBoundaryMask(boundary: SeoulBoundaryCollection): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const holes: [number, number][][] = []

  boundary.features.forEach((feature) => {
    if (feature.geometry.type === 'Polygon') {
      holes.push(feature.geometry.coordinates[0] as [number, number][])
      return
    }

    feature.geometry.coordinates.forEach((polygon) => {
      holes.push(polygon[0] as [number, number][])
    })
  })

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [WORLD_RING, ...holes],
        },
      },
    ],
  }
}

function buildCircleFeature(center: maplibregl.LngLat, radiusMeters: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const coordinates: [number, number][] = []
  const steps = 96
  const angularDistance = radiusMeters / 6371008.8
  const centerLatRad = toRadians(center.lat)
  const centerLngRad = toRadians(center.lng)

  for (let step = 0; step <= steps; step += 1) {
    const bearing = (step / steps) * Math.PI * 2
    const lat = Math.asin(
      Math.sin(centerLatRad) * Math.cos(angularDistance) +
        Math.cos(centerLatRad) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const lng =
      centerLngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLatRad),
        Math.cos(angularDistance) - Math.sin(centerLatRad) * Math.sin(lat),
      )

    coordinates.push([toDegrees(lng), toDegrees(lat)])
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
      },
    ],
  }
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function getGeometryBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoBounds {
  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      })
    })
  })

  return { minLng, minLat, maxLng, maxLat }
}

function pointInGeometry(lng: number, lat: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(lng, lat, geometry.coordinates)
  }

  return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(lng, lat, polygon))
}

function pointInPolygonCoordinates(lng: number, lat: number, coordinates: number[][][]) {
  if (!coordinates[0] || !pointInRing(lng, lat, coordinates[0])) {
    return false
  }

  return !coordinates.slice(1).some((ring) => pointInRing(lng, lat, ring))
}

function pointInRing(lng: number, lat: number, ring: number[][]) {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[previous]
    const intersects = y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function resolveViewportPadding(width: number) {
  if (width > 1280) {
    return { top: 72, right: 72, bottom: 120, left: 420 }
  }

  if (width > 980) {
    return { top: 72, right: 48, bottom: 120, left: 360 }
  }

  return { top: 84, right: 24, bottom: 190, left: 24 }
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (present.length === 0) {
    return null
  }

  return present.reduce((total, value) => total + value, 0) / present.length
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>(
    (total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    0,
  )
}

function normalize(value: number, max: number) {
  return clamp(value / max, 0.1, 1)
}

function normalizeRoot(value: number, max: number) {
  return clamp(Math.sqrt(Math.max(0, value) / max), 0.1, 1)
}

function formatDistance(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`
  }

  return `${Math.round(value)} m`
}

function formatDistanceLabel(value: number) {
  if (value < 130) {
    return 'Lens on place'
  }

  return `${formatDistance(value)} from lens center`
}

function formatGeneratedAt(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'recent'
  }

  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
    timeZoneName: 'short',
  }).format(date)
}

function formatStatusLine(dataset: LensDataset, prefix = 'Snapshot') {
  return `${dataset.hotspots.length} live places · ${prefix.toLowerCase()} ${formatGeneratedAt(dataset.generatedAt)} · check 1m · GitHub 5m`
}

function formatNullable(value: number | null, digits: number) {
  if (value === null) {
    return '—'
  }

  return value.toFixed(digits)
}

function formatPercent(value: number | null, digits = 0) {
  if (value === null) {
    return '—'
  }

  return `${value.toFixed(digits)}%`
}

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return '—'
  }

  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value)
}

function formatCompactNullable(value: number | null) {
  if (value === null) {
    return '—'
  }

  return formatCompact(value)
}

function formatSignedCompact(value: number) {
  if (value === 0) {
    return '0'
  }

  return `${value > 0 ? '+' : '−'}${formatCompact(Math.abs(value))}`
}

function formatTemperature(value: number | null) {
  if (value === null) {
    return '—'
  }

  return `${value.toFixed(1)}°C`
}

function formatSpeed(value: number | null) {
  if (value === null) {
    return '— km/h'
  }

  return `${value.toFixed(0)} km/h`
}

function formatCrowdLevel(value: string) {
  return CROWD_LEVEL_LABELS[value] ?? value
}

function normalizePlaceName(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number) {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2

  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

async function waitForMap(map: MapLibreMap) {
  if (map.isStyleLoaded()) {
    return
  }

  await new Promise<void>((resolve) => {
    map.once('load', () => resolve())
  })
}

function getPublicDataUrl(filename: string, bustCache = false) {
  const base = import.meta.env.BASE_URL || './'
  const url = new URL(`data/${filename}`, new URL(base, window.location.href))

  if (bustCache) {
    url.searchParams.set('v', String(Date.now()))
  }

  return url
}

async function loadDataset(bustCache = false) {
  const url = getPublicDataUrl('seoul-lens-data.json', bustCache)
  const response = await fetch(url, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Failed to load lens data: ${response.status}`)
  }

  return (await response.json()) as LensDataset
}

async function loadBoundary() {
  const response = await fetch(getPublicDataUrl('seoul-boundary.geojson'), { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Failed to load Seoul boundary: ${response.status}`)
  }

  return (await response.json()) as SeoulBoundaryCollection
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getById<T extends Element>(root: HTMLElement, id: string) {
  const node = root.querySelector<T>(`#${id}`)

  if (!node) {
    throw new Error(`Missing required node #${id}`)
  }

  return node
}
