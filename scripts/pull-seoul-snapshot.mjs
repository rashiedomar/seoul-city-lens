import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE_URL = 'https://data.seoul.go.kr/SeoulRtd'
const SAMPLE_HOTSPOT = process.argv[2] ?? '광화문·덕수궁'
const OUTPUT_PATH = resolve('research', 'seoul-live-snapshot.json')

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
}

async function main() {
  const referer = `${BASE_URL}/map?hotspotNm=${encodeURIComponent(SAMPLE_HOTSPOT)}`
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

  const top3Congestion = await fetchJson('intro-congestion/top3', { referer, cookie: null })

  const sample = {
    hotspot: SAMPLE_HOTSPOT,
    population: await fetchJson(`ppltn?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    populationCongestion: await fetchJson(
      `ppltn_congest?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`,
      { referer, cookie },
    ),
    road: await fetchJson(`road?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    roadGraph: await fetchJson(`roadGraph?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    weather: await fetchJson(`weather?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    parking: await fetchJson(`parking?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    event: await fetchJson(`event?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    subway: await fetchJson(`subway?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    bike: await fetchJson(`bike?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    bus: await fetchJson(`bus?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    charger: await fetchJson(`charger?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`, {
      referer,
      cookie,
    }),
    transportHourly: await fetchJson(`transport/${encodeURIComponent(SAMPLE_HOTSPOT)}`, {
      referer,
      cookie,
    }),
    transportLive30Minutes: await fetchJson(
      `transport/${encodeURIComponent(SAMPLE_HOTSPOT)}/live-30minutes-traffic`,
      {
        referer,
        cookie,
      },
    ),
    consumptionSummary: await fetchJson(
      `consumption/hotspot-summary?${new URLSearchParams({ hotspotNm: SAMPLE_HOTSPOT })}`,
      {
        referer,
        cookie,
      },
    ),
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: {
      baseUrl: BASE_URL,
      sampleHotspot: SAMPLE_HOTSPOT,
      note: 'Public SeoulRtd frontend APIs. Useful for prototyping, but the official long-term route is the Open Data Plaza API with an auth key.',
    },
    allHotspots,
    top3Congestion,
    sample,
  }

  await mkdir(resolve('research'), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

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

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Expected JSON for ${path}, got: ${text.slice(0, 200)}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
