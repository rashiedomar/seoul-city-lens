import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { createDashboard } from './dashboard'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root node')
}

const controller = createDashboard(app)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    controller.destroy()
  })
}
