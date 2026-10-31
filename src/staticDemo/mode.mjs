// Vite replaces this constant at build time; normal application paths stay intact.
export const STATIC_DEMO = import.meta.env?.VITE_TREELLIS_STATIC === 'true'

let currentScene = null
export function publishStaticScene(scene) {
  if (STATIC_DEMO) currentScene = scene
}
export function readStaticScene() {
  return currentScene ? JSON.parse(JSON.stringify(currentScene)) : null
}
