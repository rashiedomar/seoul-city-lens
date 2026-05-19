import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const URL =
  'https://nominatim.openstreetmap.org/search?city=Seoul&country=South%20Korea&format=geojson&polygon_geojson=1&limit=1'

async function main() {
  const response = await fetch(URL, {
    headers: {
      'User-Agent': 'codex-seoul-dashboard/1.0',
      Accept: 'application/geo+json, application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Seoul boundary: ${response.status}`)
  }

  const payload = await response.json()
  const feature = payload?.features?.[0]

  if (!feature?.geometry) {
    throw new Error('Boundary response did not include a geometry.')
  }

  const output = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: feature.properties?.name ?? 'Seoul',
          display_name: feature.properties?.display_name ?? 'Seoul, South Korea',
          bbox: feature.bbox ?? payload?.bbox ?? null,
        },
        geometry: feature.geometry,
      },
    ],
  }

  const outputPath = resolve('public/data/seoul-boundary.geojson')
  await writeFile(outputPath, `${JSON.stringify(output)}\n`, 'utf8')
  console.log(`Wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
