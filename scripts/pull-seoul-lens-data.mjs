import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE_URL = 'https://data.seoul.go.kr/SeoulRtd'
const OUTPUT_PATH = resolve('public', 'data', 'seoul-lens-data.json')
const CONCURRENCY = 8

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
}

async function main() {
  const referer = `${BASE_URL}/map`
  const cookie = await createSessionCookie(referer)

  const allHotspots = await fetchJson(
    `hotspot-category?${new URLSearchParams({
      page: '1',
      category: '전체보기',
      count: '200',
      sort: '혼잡도순',
    })}`,
    { referer, cookie: null },
  )

  const hotspots = await mapPool(allHotspots.row, CONCURRENCY, async (row) => {
    const hotspotNm = row.area_nm
    const hotspotReferer = `${BASE_URL}/map?hotspotNm=${encodeURIComponent(hotspotNm)}`

    const [population, transport, road, parking, weather] = await Promise.all([
      fetchJson(`ppltn?${new URLSearchParams({ hotspotNm })}`, { referer: hotspotReferer, cookie }).catch(
        () => null,
      ),
      fetchJson(`transport/${encodeURIComponent(hotspotNm)}/live-30minutes-traffic`, {
        referer: hotspotReferer,
        cookie,
      }).catch(() => null),
      fetchJson(`road?${new URLSearchParams({ hotspotNm })}`, { referer: hotspotReferer, cookie }).catch(
        () => null,
      ),
      fetchJson(`parking?${new URLSearchParams({ hotspotNm })}`, { referer: hotspotReferer, cookie }).catch(
        () => null,
      ),
      fetchJson(`weather?${new URLSearchParams({ hotspotNm })}`, { referer: hotspotReferer, cookie }).catch(
        () => null,
      ),
    ])

    const weatherNow = weather?.wall?.[0] ?? null
    const weatherForecast = Array.isArray(weather?.w24) ? weather.w24 : []
    const nextThreeHours = weatherForecast.slice(0, 3)
    const rainChanceAverage =
      nextThreeHours.length === 0
        ? null
        : round(
            nextThreeHours.reduce((sum, item) => sum + toNumber(item.POP), 0) / nextThreeHours.length,
            1,
          )

    const roads = Array.isArray(road?.row) ? road.row : []
    const avgRoadSpeed =
      roads.length === 0
        ? null
        : round(
            roads.reduce((sum, item) => sum + toNumber(item.ROAD_TRAFFIC_SPD ?? item.SPD), 0) / roads.length,
            1,
          )

    return {
      name: hotspotNm,
      category: row.category,
      lat: toNumber(row.x),
      lng: toNumber(row.y),
      crowd: {
        level: row.area_congest_lvl,
        levelNum: toNumber(row.area_congest_num),
        oneHourRate: percentageToNumber(population?.ONEHOUR_RATE),
        threeHourRate: percentageToNumber(population?.THREEHOUR_RATE),
        residentShare: toNumber(population?.RESIDENT_VALUE),
        nonResidentShare: toNumber(population?.NON_RESIDENT_VALUE),
        dominantAgeLabel: population?.TOTAL_MAX_LVL ?? null,
        dominantAgeShare: percentageToNumber(population?.TOTAL_MAX),
      },
      transit: {
        rideCount: toNumber(transport?.rideCountApproxValue),
        alightCount: toNumber(transport?.alightCountApproxValue),
        balance: toNumber(transport?.populationDifference),
        flow: transport?.populationFlow ?? null,
      },
      traffic: {
        avgRoadSpeed,
        slowRoadSegments: roads.filter((item) => item.ROAD_TRAFFIC_IDX && item.ROAD_TRAFFIC_IDX !== '원활')
          .length,
        roadSegments: roads.length,
        parkingCapacity: toNumber(parking?.totalCapacity),
        parkingAvailable: toNumber(parking?.totalAvailable),
        parkingAvailabilityRate: toNumber(parking?.percentAvailable),
      },
      weather: {
        temperature: toNumber(weatherNow?.기온),
        feelsLike: toNumber(weatherNow?.체감온도),
        rainChance: rainChanceAverage,
        pm10: toNumber(weatherNow?.PM10),
        pm25: toNumber(weatherNow?.PM25),
        uvLabel: weatherNow?.자외선지수 ?? null,
        airLabel: weatherNow?.IDEX_NM ?? null,
      },
    }
  })

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      type: 'SeoulRtd public frontend snapshot',
      count: hotspots.length,
      note: 'Crowd heatmap and lens metrics are derived from the public SeoulRtd frontend APIs and saved locally for client-side use.',
    },
    summary: {
      categories: countBy(hotspots, (item) => item.category),
      crowdLevels: countBy(hotspots, (item) => item.crowd.level),
    },
    hotspots,
  }

  await mkdir(resolve('public', 'data'), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${OUTPUT_PATH}`)
}

async function createSessionCookie(referer) {
  const response = await fetch(referer, {
    headers: browserHeaders,
    redirect: 'manual',
  })

  const setCookie = response.headers.get('set-cookie')

  if (!setCookie) {
    throw new Error('Failed to get JSESSIONID from SeoulRtd map page.')
  }

  return setCookie.split(';', 1)[0]
}

async function fetchJson(path, { referer, cookie }) {
  const response = await fetch(`${BASE_URL}/api/${path}`, {
    headers: {
      ...browserHeaders,
      Referer: referer,
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status} ${text.slice(0, 200)}`)
  }

  return JSON.parse(text)
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()))
  return results
}

function countBy(items, selector) {
  return items.reduce((result, item) => {
    const key = selector(item) ?? 'unknown'
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
}

function toNumber(value) {
  if (value === null || value === undefined || value === '' || value === '*') {
    return null
  }

  const cleaned = String(value).replaceAll(',', '').replaceAll('%', '').trim()
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function percentageToNumber(value) {
  return toNumber(value)
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
