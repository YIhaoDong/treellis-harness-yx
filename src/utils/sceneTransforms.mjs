import * as THREE from 'three'

export const VIEWPORT_SCENE_OFFSET = Object.freeze([0, -2, 0])

// A full parent*local matrix can contain shear. Decomposing it into one TRS
// and letting Object3D update it again would change the rendered geometry.
export function applyExactMatrix(object, matrix) {
  object.matrix.copy(matrix)
  object.matrixAutoUpdate = false
  object.matrixWorldNeedsUpdate = true
  return object
}

// The display offset belongs to a separate parent, including when the builder
// returns one mesh whose position is already part of the AML world transform.
export function withViewportOffset(object) {
  if (!object) return null
  const group = new THREE.Group()
  group.position.fromArray(VIEWPORT_SCENE_OFFSET)
  group.add(object)
  return group
}
