// ThreeSceneFromJSON.jsx — per-primitive material.color (#RRGGBB), base visible + ghost highlight + mini XYZ gizmo
// + Raycast hover/click -> emit path to App (onHoverPathFromScene / onClickPathFromScene)
// + repeat nodes (linear / circular) — render-only instancing (no AML instance nodes)

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { CSG } from 'three-csg-ts'
import { isRepeatNode, computeRepeatInstances } from '../utils/repeat'
import { bindViewportPicking, markViewportNavigation } from '../utils/viewportGesture.mjs'
import { applyExactMatrix, withViewportOffset } from '../utils/sceneTransforms.mjs'

/* ========== helpers ========== */
const deg = (d) => THREE.MathUtils.degToRad(d)
const HEX6 = /^#[0-9a-fA-F]{6}$/

function v3(arr, fallback = [0, 0, 0]) {
  const a = Array.isArray(arr) ? arr : []
  return [
    Number.isFinite(Number(a[0])) ? Number(a[0]) : fallback[0],
    Number.isFinite(Number(a[1])) ? Number(a[1]) : fallback[1],
    Number.isFinite(Number(a[2])) ? Number(a[2]) : fallback[2],
  ]
}

function localMatrixFromTRS(tArr, rArr, sArr) {
  const [tx, ty, tz] = v3(tArr, [0, 0, 0])
  const [rx, ry, rz] = v3(rArr, [0, 0, 0])
  const [sx, sy, sz] = v3(sArr, [1, 1, 1])
  const pos = new THREE.Vector3(tx, ty, tz)
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(deg(rx), deg(ry), deg(rz), 'XYZ')
  )
  const scl = new THREE.Vector3(sx, sy, sz)
  const m = new THREE.Matrix4()
  m.compose(pos, quat, scl)
  return m
}

function localMatrixFromTransform(tf) {
  const [tx = 0, ty = 0, tz = 0] = tf?.t || []
  const [rx = 0, ry = 0, rz = 0] = tf?.r || []
  const [sx = 1, sy = 1, sz = 1] = tf?.s || []
  return localMatrixFromTRS([tx, ty, tz], [rx, ry, rz], [sx, sy, sz])
}

/** Map repeat instances (TRS) -> Matrix4 list */
function computeRepeatInstanceMatrices(node) {
  const inst = computeRepeatInstances(node) // [{t,r,s}]
  return inst.map(({ t, r, s }) => localMatrixFromTRS(t, r, s))
}

function pickColorHex(prim) {
  const c = prim?.material?.color
  return (typeof c === 'string' && HEX6.test(c)) ? c : '#8BC34A'
}

function makePrimitive(prim) {
  if (!prim || !prim.type) return null
  const mat = new THREE.MeshStandardMaterial({
    color: pickColorHex(prim),
    metalness: 0.3,
    roughness: 0.5
  })
  const type = String(prim.type).toLowerCase()
  switch (type) {
    case 'cylinder': {
      const r = prim.r ?? 1, h = prim.h ?? 1
      const rs = Math.max(3, prim.radialSegments ?? 32)
      return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, rs), mat)
    }
    case 'torus': {
      const R = prim.r ?? 1, t = prim.t ?? 0.2
      const rs = Math.max(3, prim.radialSegments ?? 16)
      const ts = Math.max(3, prim.tubularSegments ?? 100)
      return new THREE.Mesh(new THREE.TorusGeometry(R, t, rs, ts), mat)
    }
    case 'sphere': {
      const r = prim.r ?? 1
      const ws = Math.max(3, prim.widthSegments ?? 16)
      const hs = Math.max(2, prim.heightSegments ?? 12)
      return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat)
    }
    case 'cube': {
      const w = prim.w ?? 1, h = prim.h ?? 1, d = prim.d ?? 1
      return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    }
    case 'cone': {
      const r = prim.r ?? 1, h = prim.h ?? 1
      const rs = Math.max(3, prim.radialSegments ?? 32)
      return new THREE.Mesh(new THREE.ConeGeometry(r, h, rs), mat)
    }
    default:
      console.warn('[makePrimitive] Unknown primitive type:', prim?.type, prim)
      return null
  }
}

/* ===== visual scene ===== */

/**
 * CSG builder:
 * - returns a single Mesh (fold union/subtract/intersect into one mesh)
 * - repeat nodes: expand its template (primitive + children) per instance, then union
 */
function buildCSGNode(node, parentWorld = new THREE.Matrix4(), path = '0') {
  // repeat in CSG context
  if (isRepeatNode(node)) {
    const local = localMatrixFromTransform(node.transform || {})
    const worldBase = new THREE.Matrix4().multiplyMatrices(parentWorld, local)

    const instMats = computeRepeatInstanceMatrices(node)
    const template = {
      ...node,
      repeat: undefined,
      // treat repeat node content as template; do NOT re-apply its transform
      transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
      operation: 'union'
    }

    const meshes = []
    for (let k = 0; k < instMats.length; k++) {
      const instWorld = new THREE.Matrix4().multiplyMatrices(worldBase, instMats[k])
      const mk = buildCSGNode(template, instWorld, path)
      if (mk) meshes.push(mk)
    }
    if (!meshes.length) return null

    let acc = meshes.shift()
    for (let i = 0; i < meshes.length; i++) {
      const A = CSG.fromMesh(acc), B = CSG.fromMesh(meshes[i])
      const res = A.union(B)
      acc = CSG.toMesh(res, new THREE.Matrix4(), acc.material)
      applyExactMatrix(acc, new THREE.Matrix4())
      acc.userData.path = path
    }
    acc.castShadow = true
    acc.receiveShadow = true
    return acc
  }

  const local = localMatrixFromTransform(node.transform || {})
  const world = new THREE.Matrix4().multiplyMatrices(parentWorld, local)

  let acc = null
  if (node.primitive) {
    const m = makePrimitive(node.primitive)
    if (m) {
      applyExactMatrix(m, world)
      m.userData.path = path
      acc = m
    }
  }

  const children = Array.isArray(node.children) ? node.children : []
  const kids = children.map((c, i) => buildCSGNode(c, world, `${path}.${i}`)).filter(Boolean)
  if (!acc && kids.length) acc = kids.shift()

  const op = (node.operation || 'union').toLowerCase()
  for (let i = 0; i < kids.length; i++) {
    const A = CSG.fromMesh(acc), B = CSG.fromMesh(kids[i])
    const res = op === 'subtract' || op === 'difference' ? A.subtract(B)
      : (op === 'intersection' || op === 'intersect') ? A.intersect(B)
        : A.union(B)
    acc = CSG.toMesh(res, new THREE.Matrix4(), acc.material)
    applyExactMatrix(acc, new THREE.Matrix4())
    acc.userData.path = path
  }

  if (acc) { acc.castShadow = true; acc.receiveShadow = true }
  return acc
}

/**
 * Hierarchical visual builder (non-CSG union):
 * - subtract/intersect nodes use CSG to generate one mesh
 * - union nodes keep hierarchy (better picking granularity)
 * - repeat nodes: expand per instance (render-only, no instance AML paths)
 */
function buildVisualScene(node, parentWorld = new THREE.Matrix4(), path = '0') {
  const local = localMatrixFromTransform(node.transform || {})
  const worldBase = new THREE.Matrix4().multiplyMatrices(parentWorld, local)
  const op = (node.operation || 'union').toLowerCase()

  // CSG ops: directly generate merged mesh, bind path to result
  if (op === 'subtract' || op === 'difference' || op === 'intersection' || op === 'intersect') {
    return buildCSGNode(node, parentWorld, path)
  }

  // repeat node expansion (render-only instancing)
  if (isRepeatNode(node)) {
    const instMats = computeRepeatInstanceMatrices(node)
    const group = new THREE.Group()

    // repeat node primitive (optional): repeated primitive belongs to repeat node path
    if (node.primitive) {
      for (let k = 0; k < instMats.length; k++) {
        const m = makePrimitive(node.primitive)
        if (!m) continue
        const world = new THREE.Matrix4().multiplyMatrices(worldBase, instMats[k])
        applyExactMatrix(m, world)
        m.userData.path = path
        m.castShadow = true
        m.receiveShadow = true
        group.add(m)
      }
    }

    // repeat children are templates: each instance reuses the SAME template path `${path}.${i}`
    const kids = Array.isArray(node.children) ? node.children : []
    for (let k = 0; k < instMats.length; k++) {
      const instWorld = new THREE.Matrix4().multiplyMatrices(worldBase, instMats[k])
      kids.forEach((c, i) => {
        const child = buildVisualScene(c, instWorld, `${path}.${i}`)
        if (child) group.add(child)
      })
    }

    if (group.children.length === 1) return group.children[0]
    if (group.children.length === 0) return null
    return group
  }

  // normal/union: keep hierarchy, bind each primitive mesh to its own path
  const group = new THREE.Group()

  if (node.primitive) {
    const m = makePrimitive(node.primitive)
    if (m) {
      applyExactMatrix(m, worldBase)
      m.userData.path = path
      m.castShadow = true
      m.receiveShadow = true
      group.add(m)
    }
  }

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((c, i) => {
      const child = buildVisualScene(c, worldBase, `${path}.${i}`)
      if (child) group.add(child)
    })
  }

  if (group.children.length === 1) return group.children[0]
  if (group.children.length === 0) return null
  return group
}

/* ===== ghost highlight ===== */
/**
 * repeat-aware ghost builder:
 * - no instance paths; all instances map to the SAME template path
 * - index[path].meshes contains all instance meshes for that template node (& descendants)
 */
function buildGhostAndIndex(root) {
  const ghostGroup = new THREE.Group()
  const index = new Map()

  const ensureEntry = (path) => {
    if (!index.has(path)) index.set(path, { path, meshes: [] })
    return index.get(path)
  }

  const makeGhostMeshFromPrimitive = (prim, worldMatrix, templatePath) => {
    const m = makePrimitive(prim)
    if (!m) return null
    applyExactMatrix(m, worldMatrix)
    m.visible = false
    m.castShadow = false
    m.receiveShadow = false
    m.material = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      emissive: 0xfff000,
      emissiveIntensity: 1,
      metalness: 0.1,
      roughness: 0.3,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
      polygonOffset: false,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    })
    m.renderOrder = 2
    m.raycast = () => null
    m.userData.path = templatePath
    return m
  }

  function dfs(node, parentWorld, path) {
    const entry = ensureEntry(path)

    const local = localMatrixFromTransform(node.transform || {})
    const worldBase = new THREE.Matrix4().multiplyMatrices(parentWorld, local)

    let created = []

    // repeat expansion in ghost/index
    if (isRepeatNode(node)) {
      const instMats = computeRepeatInstanceMatrices(node)

      for (let k = 0; k < instMats.length; k++) {
        const instWorld = new THREE.Matrix4().multiplyMatrices(worldBase, instMats[k])

        // repeat node primitive (optional)
        if (node.primitive) {
          const gm = makeGhostMeshFromPrimitive(node.primitive, instWorld, path)
          if (gm) {
            ghostGroup.add(gm)
            entry.meshes.push(gm)
            created.push(gm)
          }
        }

        // children templates
        const kids = Array.isArray(node.children) ? node.children : []
        kids.forEach((child, i) => {
          const childPath = `${path}.${i}`
          const childCreated = dfs(child, instWorld, childPath)
          if (childCreated.length) {
            entry.meshes.push(...childCreated)
            created.push(...childCreated)
          }
        })
      }

      return created
    }

    // normal primitive
    if (node.primitive) {
      const gm = makeGhostMeshFromPrimitive(node.primitive, worldBase, path)
      if (gm) {
        ghostGroup.add(gm)
        entry.meshes.push(gm)
        created.push(gm)
      }
    }

    // children
    if (Array.isArray(node.children)) {
      node.children.forEach((child, i) => {
        const childPath = `${path}.${i}`
        const childCreated = dfs(child, worldBase, childPath)
        if (childCreated.length) {
          entry.meshes.push(...childCreated)
          created.push(...childCreated)
        }
      })
    }

    return created
  }

  dfs(root, new THREE.Matrix4(), '0')
  return { ghostGroup, index }
}

function unionMeshes(meshes) {
  if (!meshes || meshes.length === 0) return null
  let acc = meshes[0].clone()
  acc.geometry = meshes[0].geometry.clone()
  acc.material = meshes[0].material.clone()

  for (let i = 1; i < meshes.length; i++) {
    const mi = meshes[i].clone()
    mi.geometry = meshes[i].geometry.clone()
    const A = CSG.fromMesh(acc)
    const B = CSG.fromMesh(mi)
    const res = A.union(B)
    acc = CSG.toMesh(res, new THREE.Matrix4(), acc.material)
    applyExactMatrix(acc, new THREE.Matrix4())
  }

  acc.material = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xfff000,
    emissiveIntensity: 0.8,
    metalness: 0.1,
    roughness: 0.3,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })
  acc.renderOrder = 2
  acc.raycast = () => null

  return acc
}

/* ======= Global Raycaster inside Canvas ======= */
function SceneRayPicker({ getPickables, onHoverPath, onClickPath }) {
  const { gl, camera } = useThree()
  const rayRef = useRef(new THREE.Raycaster())
  const pointer = useRef(new THREE.Vector2())
  const callbacksRef = useRef({ getPickables, onHoverPath, onClickPath })
  callbacksRef.current = { getPickables, onHoverPath, onClickPath }

  const extractPath = (obj) => {
    let o = obj
    while (o) {
      if (o.userData && o.userData.path != null) return String(o.userData.path)
      o = o.parent
    }
    return null
  }

  const doIntersect = useCallback((clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect()
    pointer.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
    if (!rect.width || !rect.height) return null
    const objs = callbacksRef.current.getPickables?.() || []
    if (!objs.length) return null
    rayRef.current.setFromCamera(pointer.current, camera)
    const hits = rayRef.current.intersectObjects(objs, true)
    if (!hits.length) return null
    const hit = hits.find(h => extractPath(h.object)) || hits[0]
    return extractPath(hit.object)
  }, [camera, gl.domElement])

  useEffect(() => bindViewportPicking(gl.domElement, {
    intersect: doIntersect,
    onHoverPath: (path) => callbacksRef.current.onHoverPath?.(path),
    onClickPath: (path, options) => callbacksRef.current.onClickPath?.(path, options),
  }), [gl.domElement, doIntersect])

  return null
}

// GizmoViewport axis heads stop R3F propagation internally. Detect their actual
// HUD geometry before native picking starts, rather than reserving a screen area.
function NavigationGizmo({ children }) {
  const { gl, camera } = useThree()
  const groupRef = useRef(null)
  const rayRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())

  useEffect(() => {
    const element = gl.domElement
    const onDown = (event) => {
      if (!groupRef.current) return
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointerRef.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      groupRef.current.updateWorldMatrix(true, true)
      camera.updateMatrixWorld()
      rayRef.current.setFromCamera(pointerRef.current, camera)
      if (rayRef.current.intersectObject(groupRef.current, true).length) {
        markViewportNavigation(event)
      }
    }
    element.addEventListener('pointerdown', onDown, true)
    return () => element.removeEventListener('pointerdown', onDown, true)
  }, [camera, gl.domElement])

  return <group ref={groupRef}>{children}</group>
}

function ViewportGizmo({ controlsRef }) {
  const { size } = useThree()
  const shortestSide = Math.min(size.width, size.height)
  if (shortestSide < 40) return null
  const scale = Math.min(1, (shortestSide - 12) / 120)
  return (
    <GizmoHelper alignment="bottom-left" margin={[72 * scale, 72 * scale]}
      onTarget={() => controlsRef.current?.target} renderPriority={1}>
      <group scale={scale}>
        <NavigationGizmo>
          <GizmoViewport axisColors={['#ff3653', '#8adb00', '#2c8fff']}
            hideNegativeAxes={false} labelColor="#ffffff" axisHeadScale={1.3} axisScale={[0.8, 0.05, 0.05]} />
        </NavigationGizmo>
      </group>
    </GizmoHelper>
  )
}

// Keep edits and panel changes from resetting the camera. On a compact size
// change, only move back if necessary, preserving the user's target and angle.
function FrameLoadedScene({ object, controlsRef, responsive = false }) {
  const { camera, invalidate, size } = useThree()
  const framedRef = useRef(null)
  useEffect(() => {
    if (!object || !controlsRef.current || size.width <= 0 || size.height <= 0) return
    const previous = framedRef.current
    if (previous && (!responsive || previous.width === size.width && previous.height === size.height)) return
    const bounds = new THREE.Box3().setFromObject(object)
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect))
    const target = previous ? controlsRef.current.target.clone() : sphere.center
    const radius = sphere.radius + (previous ? target.distanceTo(sphere.center) : 0)
    const requiredDistance = radius / Math.sin(limitingFov) * 1.15
    const distance = previous ? Math.max(requiredDistance, camera.position.distanceTo(target)) : requiredDistance
    const direction = camera.position.clone().sub(controlsRef.current.target).normalize()
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.near = Math.max(distance / 1000, 0.01)
    camera.far = Math.max(distance * 100, 1000)
    camera.updateProjectionMatrix()
    controlsRef.current.target.copy(target)
    controlsRef.current.update()
    framedRef.current = { width: size.width, height: size.height }
    invalidate()
  }, [object, camera, controlsRef, invalidate, responsive, size.width, size.height])
  return null
}

/* ========== component ========== */
export default function ThreeSceneFromJSON({
  scene,                 // in-memory scene (preferred)
  url = '/scene.json',   // fallback if scene is not provided
  highlightPath,
  highlightPaths,
  unionHighlight = false,
  debug = false,
  frameOnLoad = false,
  responsiveFraming = false,
  onHoverPathFromScene,      // (path|null) => void
  onClickPathFromScene       // (path|null, { shiftKey, additive }) => void
}) {
  const [sceneObj, setSceneObj] = useState(null)

  const mergedRef = useRef(null)
  const ghostRef = useRef(null)
  const indexRef = useRef(new Map())
  const [unionMesh, setUnionMesh] = useState(null)

  // pickables (all meshes that can be raycasted)
  const pickablesRef = useRef([])
  const getPickables = useCallback(() => pickablesRef.current, [])

  // keep a ref to OrbitControls so gizmo can follow its target
  const controlsRef = useRef(null)

  const collectPickables = useCallback((root) => {
    const list = []
    if (!root) return list
    root.traverse((o) => { if (o.isMesh) list.push(o) })
    return list
  }, [])

  // Build from `scene` when provided; otherwise fetch by url
  useEffect(() => {
    let active = true

    const buildFrom = (sourceScene) => {
      const visual = buildVisualScene(sourceScene, new THREE.Matrix4(), '0')
      if (visual) {
        visual.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
      }
      mergedRef.current = withViewportOffset(visual)
      pickablesRef.current = collectPickables(visual)

      const { ghostGroup, index } = buildGhostAndIndex(sourceScene)
      ghostRef.current = withViewportOffset(ghostGroup)
      indexRef.current = index

      if (active) {
        setSceneObj(sourceScene)
        setUnionMesh(null)
      }
    }

    if (scene) {
      buildFrom(scene)
    } else {
      (async () => {
        try {
          const res = await fetch(url, { cache: 'no-store' })
          const json = await res.json()
          const source = json.scene || json
          if (active) buildFrom(source)
        } catch (e) {
          console.error('Failed to load scene JSON:', e)
        }
      })()
    }

    return () => { active = false }
  }, [scene, url, collectPickables])

  // highlight update
  useEffect(() => {
    // An explicitly provided array owns highlighting, including an empty set.
    const paths = Array.isArray(highlightPaths) ? highlightPaths : highlightPath ? [highlightPath] : []
    if (!sceneObj || paths.length === 0) {
      if (ghostRef.current) {
        ghostRef.current.traverse((o) => { if (o.isMesh) o.visible = false })
      }
      setUnionMesh(null)
      return
    }

    const selectedMeshes = new Set()
    for (const path of paths) {
      const entry = indexRef.current.get(String(path))
      if (!entry && debug) console.warn('[Highlight] path not found:', path)
      entry?.meshes.forEach(mesh => selectedMeshes.add(mesh))
    }
    const meshes = [...selectedMeshes]

    if (!unionHighlight) {
      if (ghostRef.current) {
        ghostRef.current.traverse((o) => { if (o.isMesh) o.visible = false })
        meshes.forEach((m) => { m.visible = true })
      }
      setUnionMesh(null)
      if (debug) console.log('[Highlight] toggle only, meshes:', meshes.length)
    } else {
      if (ghostRef.current) {
        ghostRef.current.traverse((o) => { if (o.isMesh) o.visible = false })
      }
      const m = unionMeshes(meshes)
      setUnionMesh(withViewportOffset(m))
      if (debug) console.log('[Highlight] union overlay meshes:', meshes.length, !!m)
    }
  }, [sceneObj, highlightPath, highlightPaths, unionHighlight, debug])

  return (
    <Canvas aria-label="3D viewport" shadows camera={{ position: [10, 10, 10], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight
        castShadow
        position={[10, 10, 5]}
        intensity={1}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <shadowMaterial opacity={0.2} />
      </mesh>

      {/* base visual scene */}
      {mergedRef.current && (
        <primitive object={mergedRef.current} />
      )}

      {/* ghost copy (always mounted, children invisible until highlighted) */}
      {ghostRef.current && (
        <primitive object={ghostRef.current} />
      )}

      {/* union overlay as a single mesh (optional mode) */}
      {unionHighlight && unionMesh && (
        <primitive object={unionMesh} />
      )}

      {/* Global raycaster that maps hover/click -> path */}
      <SceneRayPicker
        getPickables={getPickables}
        onHoverPath={onHoverPathFromScene}
        onClickPath={onClickPathFromScene}
      />

      {/* Controls + Mini XYZ axis */}
      <OrbitControls ref={controlsRef} makeDefault enableDamping />
      {(frameOnLoad || responsiveFraming) && sceneObj && <FrameLoadedScene object={mergedRef.current} controlsRef={controlsRef} responsive={responsiveFraming} />}

      <ViewportGizmo controlsRef={controlsRef} />
    </Canvas>
  )
}
