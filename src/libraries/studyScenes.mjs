import airplane from './scenes/Original-Toy-Biplane.json'
import bicycle from './scenes/User-Study-2-Child-Parent-Bicycle.json'
import rocket from './scenes/Demonstration-Walkthrough-Rocket.json'
import raceCar from './scenes/Toy-Race-Car.json'
import toriiGates from './scenes/Torii-Gates.json'
import droolingFace from './scenes/Drooling-Face.json'
import heatExchanger from './scenes/User-Study-2-Heat-Exchanger.json'
import powerStrip from './scenes/User-Study-2-PowerStrip.json'
import toilet from './scenes/User-Walkthrough-Toilet.json'

// Explicitly selected models, including the requested Figure 3 rocket and
// Torii Gates scene. Do not glob other showcase or branded demonstration work.
export const studyScenes = [
  { id: 'simple-biplane', title: 'Simple Biplane', scene: airplane },
  { id: 'rocket', title: 'Rocket', scene: rocket },
  { id: 'race-car', title: 'Toy Race Car', scene: raceCar },
  { id: 'torii-gates', title: 'Torii Gates', scene: toriiGates },
  { id: 'drooling-face', title: 'Drooling Face', scene: droolingFace },
  { id: 'bicycle', title: 'Parent–Child Bicycle', scene: bicycle },
  { id: 'heat-exchanger', title: 'Heat Exchanger', scene: heatExchanger },
  { id: 'power-strip', title: 'Power Strip', scene: powerStrip },
  { id: 'toilet', title: 'Toilet', scene: toilet },
]

export function createLibraryScene(id) {
  const entry = studyScenes.find(item => item.id === id)
  if (!entry) return null
  // Every load starts with an independent original, even after editing a model.
  return JSON.parse(JSON.stringify(entry.scene.scene || entry.scene))
}
