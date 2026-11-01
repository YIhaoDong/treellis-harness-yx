import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sceneSource = process.env.TREELLIS_STATIC_SCENE_SOURCE
  ? path.resolve(appRoot, process.env.TREELLIS_STATIC_SCENE_SOURCE)
  : path.join(appRoot, 'src/staticDemo/scene.json')
const projectRoot = process.env.TREELLIS_STATIC_PROJECT_ROOT
  ? path.resolve(appRoot, process.env.TREELLIS_STATIC_PROJECT_ROOT) : null
const desktopDestination = process.env.TREELLIS_STATIC_DESKTOP_DESTINATION
  ? path.resolve(appRoot, process.env.TREELLIS_STATIC_DESKTOP_DESTINATION) : null
const htmlDestination = path.join(appRoot, 'static-demo/treellis-static.html')
const projectHtmlDestination = projectRoot && path.join(projectRoot, 'static-demo/treellis-static.html')
const reportDestination = path.join(appRoot, 'output/static-demo/build-report.json')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const slash = value => value.replaceAll('\\', '/')

const mimeTypes = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

async function write(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
}

function sceneStats(value) {
  const root = value.scene || value
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('The exact source does not contain a scene object.')
  const pending = [root]
  let nodes = 0, primitives = 0
  while (pending.length) {
    const node = pending.pop()
    nodes++
    primitives += Number(Boolean(node.primitive))
    pending.push(...(node.children || []))
  }
  if (!primitives) throw new Error('The exact source scene contains no primitives.')
  return { name: root.name || null, nodes, primitives }
}

function outputBytes(item) {
  return Buffer.from(item.type === 'chunk' ? item.code : item.source)
}

// JavaScript assets become Blob URLs. The current frontend emits no workers;
// this generic worker branch is not a claim of browser-verified worker support.
// WASM is rejected by the build until an explicit byte-instantiation path exists.
function treellisStaticAssetUrl(name) {
  const asset = __TREELLIS_STATIC_ASSETS[name]
  if (!asset) throw new Error('Missing embedded static asset: ' + name)
  if (asset.kind !== 'script') return asset.dataUrl
  if (__TREELLIS_STATIC_URLS[name]) return __TREELLIS_STATIC_URLS[name]
  const bootstrap = 'const __TREELLIS_STATIC_ASSETS=' + JSON.stringify(__TREELLIS_STATIC_ASSETS)
    + ';const __TREELLIS_STATIC_URLS=Object.create(null);const treellisStaticAssetUrl='
    + treellisStaticAssetUrl.toString() + ';\n'
  const url = URL.createObjectURL(new Blob([bootstrap, asset.source], { type: 'text/javascript' }))
  __TREELLIS_STATIC_URLS[name] = url
  return url
}

function inlineOutput(output) {
  const wasmAssets = output.filter(item => /\.wasm$/i.test(item.fileName)).map(item => item.fileName)
  const frontendModules = [...new Set(output.flatMap(item => item.type === 'chunk' ? Object.keys(item.modules) : []))].sort()
  const wasmModules = frontendModules.filter(name => /\.wasm(?:$|\?)/i.test(name))
  const embeddedWasm = output.some(item => /data:application\/wasm/i.test(outputBytes(item).toString('utf8')))
  if (wasmAssets.length || wasmModules.length || embeddedWasm) {
    throw new Error('Static build encountered WASM. Add an explicit embedded-byte WebAssembly.instantiate path before publishing; fetch-based WASM is not supported. ' + JSON.stringify({ wasmAssets, wasmModules, embeddedWasm }))
  }
  const files = new Map(output.map(item => [slash(item.fileName), item]))
  const htmlEntry = output.find(item => item.type === 'asset' && item.fileName === 'index.html')
  if (!htmlEntry) throw new Error('Vite did not emit index.html.')
  const aliases = new Map()
  for (const name of files.keys()) {
    for (const alias of [name, './' + name, '/' + name, path.posix.basename(name), './' + path.posix.basename(name)]) {
      if (!aliases.has(alias)) aliases.set(alias, name)
      else if (aliases.get(alias) !== name) aliases.set(alias, null)
    }
  }
  const resolve = value => aliases.get(value.split(/[?#]/, 1)[0]) || null
  const isScript = item => /\.(?:m?js)$/.test(item.fileName)
  const assets = {}
  const dataUrl = item => 'data:' + (mimeTypes[path.extname(item.fileName)] || 'application/octet-stream')
    + ';base64,' + outputBytes(item).toString('base64')
  const replaceAssetLiterals = source => {
    for (const [alias, name] of aliases) {
      if (!name || name === 'index.html') continue
      const replacement = 'treellisStaticAssetUrl(' + JSON.stringify(name) + ')'
      for (const quote of ['"', "'", String.fromCharCode(96)]) {
        source = source.replaceAll(quote + alias + quote, replacement)
      }
    }
    return source
  }
  for (const [name, item] of files) {
    if (name === 'index.html') continue
    assets[name] = isScript(item)
      ? { kind: 'script', source: replaceAssetLiterals(outputBytes(item).toString('utf8')) }
      : { kind: 'data', dataUrl: dataUrl(item) }
  }
  const unresolvedPublicIcons = Object.entries(assets).filter(([, asset]) => asset.kind === 'script')
    .flatMap(([name, asset]) => [...asset.source.matchAll(/(["'])\/icons\/[^"'\r\n]+\1/g)].map(match => ({ name, reference: match[0] })))
  if (unresolvedPublicIcons.length) throw new Error('A public icon was not embedded: ' + JSON.stringify(unresolvedPublicIcons))
  const runtimeAssets = Object.fromEntries(Object.entries(assets).filter(([name]) => !files.get(name).isEntry))
  const bootstrap = 'const __TREELLIS_STATIC_ASSETS=' + JSON.stringify(runtimeAssets)
    + ';const __TREELLIS_STATIC_URLS=Object.create(null);const treellisStaticAssetUrl='
    + treellisStaticAssetUrl.toString() + ';\n'
  const inlineCss = source => source.replace(/url\(\s*(?:(["'])(.*?)\1|([^)'"]+))\s*\)/g, (match, quote, quoted, unquoted) => {
    const url = String(quoted ?? unquoted).trim()
    const name = resolve(url)
    return name ? 'url("' + dataUrl(files.get(name)) + '")' : match
  })
  let html = outputBytes(htmlEntry).toString('utf8')
  html = html.replace(/<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*>\s*/gi, '')
  let entryScripts = 0
  html = html.replace(/<script\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*)>\s*<\/script>/gi,
    (match, before, quote, src, after) => {
      const name = resolve(src), item = name && files.get(name)
      if (!item || !isScript(item)) throw new Error('An external script remains in static HTML: ' + src)
      const imports = item.type === 'chunk' ? [...item.imports, ...item.dynamicImports] : []
      if (imports.length) throw new Error('The entry still has separate module imports: ' + imports.join(', '))
      entryScripts++
      // Bundled binary signatures may contain raw control characters in string
      // literals. Escape them so the offline file also passes Vite's HTML parser.
      const code = (bootstrap + assets[name].source).replace(/<\/script/gi, '<\\/script')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
          character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
      return '<script type="module">\n' + code + '\n</script>'
    })
  html = html.replace(/<link\b([^>]*?)>/gi, (match, attributes) => {
    const rel = /\brel=["']([^"']*)["']/i.exec(attributes)?.[1] || ''
    const href = /\bhref=["']([^"']*)["']/i.exec(attributes)?.[1]
    if (rel.toLowerCase() !== 'stylesheet') return match
    const name = href && resolve(href)
    if (!name) throw new Error('An external stylesheet remains in static HTML: ' + href)
    return '<style>\n' + inlineCss(outputBytes(files.get(name)).toString('utf8')).replace(/<\/style/gi, '<\\/style') + '\n</style>'
  })
  html = html.replace(/\b(src|href|poster)=(["'])(.*?)\2/gi, (match, attribute, quote, value) => {
    const name = resolve(value)
    return name ? attribute + '=' + quote + dataUrl(files.get(name)) + quote : match
  })
  if (entryScripts !== 1) throw new Error('Expected one fully bundled entry script; found ' + entryScripts + '.')
  const externalTags = [...html.matchAll(/<(?:script|link|img|source|video|audio)\b[^>]*\b(?:src|href)=["'](?!data:|blob:|#)([^"']+)["'][^>]*>/gi)].map(match => match[1])
  const leftoverAssetPaths = [...html.matchAll(/(?:src|href)=["'](?:\.\/|\/)?assets\/[^"']+["']/gi)].map(match => match[0])
  const externalCssUrls = [...html.matchAll(/url\(\s*["']?(https?:\/\/[^)'"]+)/gi)].map(match => match[1])
  if (externalTags.length || leftoverAssetPaths.length || externalCssUrls.length) {
    throw new Error('Static HTML still refers to external assets: ' + JSON.stringify({ externalTags, leftoverAssetPaths, externalCssUrls }))
  }
  return {
    html,
    assetReport: output.map(item => ({
      name: item.fileName, type: item.type, bytes: outputBytes(item).length,
      mime: mimeTypes[path.extname(item.fileName)] || null,
      imports: item.type === 'chunk' ? item.imports : [],
      dynamicImports: item.type === 'chunk' ? item.dynamicImports : [],
    })),
    checks: { entryScripts, externalTags, leftoverAssetPaths, externalCssUrls, unresolvedPublicIcons, modulePreload: /<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*>/i.test(html) },
    runtimeFeatures: {
      wasmAssets, wasmModules, embeddedWasm,
      emittedWorkerScripts: output.filter(item => isScript(item) && !item.isEntry).map(item => item.fileName),
      workerModules: frontendModules.filter(name => /[?&]worker(?:&|$)|(?:^|\/)[^/]*[Ww]orker\.(?:[cm]?[jt]sx?)(?:\?|$)/.test(slash(name))),
      note: 'No active WASM or worker pipeline is used by the current editor frontend. Emitted assets and module paths are recorded here; generic Blob-worker handling has not been exercised by this build. Any future WASM causes a clear build failure until byte instantiation is implemented.',
    },
    frontendModules,
  }
}

async function publicIconAssets() {
  const directory = path.join(appRoot, 'public/icons')
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return Promise.all(entries.filter(entry => entry.isFile() && /\.svg$/i.test(entry.name)).map(async entry => ({
    type: 'asset',
    fileName: 'icons/' + entry.name,
    source: await fs.readFile(path.join(directory, entry.name)),
    originalFileNames: [slash(path.join(directory, entry.name))],
    staticSource: 'public/icons runtime string reference',
  })))
}

async function dependencyReport() {
  const manifest = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'))
  const require = createRequire(path.join(appRoot, 'package.json'))
  const dependencies = {}
  for (const [name, declared] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    let installed = null, entry = null
    try {
      entry = require.resolve(name)
      let dir = path.dirname(entry)
      while (dir !== path.dirname(dir)) {
        try {
          const candidate = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
          if (candidate.name === name) { installed = candidate.version; break }
        } catch {}
        dir = path.dirname(dir)
      }
    } catch {}
    dependencies[name] = { declared, installed, entry }
  }
  return dependencies
}

async function sourceManifest(frontendModules, output) {
  const localPrefix = slash(appRoot) + '/'
  const sourceFiles = new Set([
    'package.json', 'vite.config.mjs', 'index.html', 'scripts/build-static.mjs',
    ...frontendModules.map(slash).filter(name => name.startsWith(localPrefix + 'src/'))
      .map(name => name.slice(localPrefix.length).split('?', 1)[0]),
    ...output.filter(item => item.staticSource).map(item => 'public/' + item.fileName),
  ])
  const files = []
  for (const relative of [...sourceFiles].sort()) {
    const absolute = path.join(appRoot, relative)
    const bytes = await fs.readFile(absolute)
    files.push({ relative, absolute, bytes: bytes.length, sha256: sha256(bytes) })
  }
  return {
    capturedAt: new Date().toISOString(), sourceRoot: appRoot, files,
    note: 'Current owning-app files used by the frontend graph plus build configuration and embedded public icons. This is a file inventory for source review/copying, not an automatic source migration.',
  }
}

async function main() {
  // An explicitly selected source must exist; otherwise use the bundled airplane.
  const sceneBytes = await fs.readFile(sceneSource)
  const scene = sceneStats(JSON.parse(sceneBytes.toString('utf8')))
  const sceneHash = sha256(sceneBytes)
  const sceneDestinations = [
    path.join(appRoot, 'src/staticDemo/scene.json'),
    path.join(appRoot, 'static-demo/scene.json'),
    projectRoot && path.join(projectRoot, 'static-demo/scene.json'),
  ].filter(Boolean)
  for (const destination of sceneDestinations) {
    await write(destination, sceneBytes)
    if (sha256(await fs.readFile(destination)) !== sceneHash) throw new Error('Scene copy verification failed: ' + destination)
  }
  process.env.VITE_TREELLIS_STATIC = 'true'
  const { build, version: viteVersion } = await import('vite')
  const startedAt = new Date().toISOString()
  const bundle = await build({
    root: appRoot,
    configFile: path.join(appRoot, 'vite.config.mjs'),
    mode: 'static',
    build: { write: false },
  })
  const outputs = Array.isArray(bundle) ? bundle : [bundle]
  if (outputs.length !== 1 || !Array.isArray(outputs[0]?.output)) throw new Error('Expected one Vite output bundle.')
  const output = [...outputs[0].output, ...await publicIconAssets()]
  const { html, assetReport, checks, runtimeFeatures, frontendModules } = inlineOutput(output)
  const sources = await sourceManifest(frontendModules, output)
  const htmlBytes = Buffer.from(html)
  const destinations = [htmlDestination, projectHtmlDestination, desktopDestination].filter(Boolean)
  for (const destination of destinations) {
    await write(destination, htmlBytes)
    if (sha256(await fs.readFile(destination)) !== sha256(htmlBytes)) throw new Error('HTML copy verification failed: ' + destination)
  }
  const report = {
    schemaVersion: 1, startedAt, completedAt: new Date().toISOString(),
    sourceRoot: appRoot, node: process.version, vite: viteVersion,
    command: 'npm run build:static', flag: 'VITE_TREELLIS_STATIC=true',
    scene: { source: sceneSource, ...scene, bytes: sceneBytes.length, sha256: sceneHash, copies: sceneDestinations },
    html: { bytes: htmlBytes.length, sha256: sha256(htmlBytes), destinations },
    assets: assetReport, checks, runtimeFeatures, frontendModules, sources, dependencies: await dependencyReport(),
    scope: 'Vite write:false; normal dist is not written. Static assets are embedded; no package installation.',
    validationLimits: 'Build and resource-reference checks only; browser file:// rendering and interaction require separate verification.',
  }
  await write(reportDestination, JSON.stringify(report, null, 2) + '\n')
  if (projectRoot) await write(path.join(projectRoot, 'output/static-demo/build-report.json'), JSON.stringify(report, null, 2) + '\n')
  await write(path.join(appRoot, 'output/static-demo/source-manifest.json'), JSON.stringify(sources, null, 2) + '\n')
  if (projectRoot) await write(path.join(projectRoot, 'output/static-demo/source-manifest.json'), JSON.stringify(sources, null, 2) + '\n')
  console.log(JSON.stringify({ html: htmlDestination, bytes: htmlBytes.length, sha256: report.html.sha256, report: reportDestination, scene }, null, 2))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
