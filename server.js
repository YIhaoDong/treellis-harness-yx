// server.js — write-component + commit + draft(SSE) + static + robust CORS
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { createGenerationJobs, publicError } = require('./src/generation/jobs.cjs');

const app = express();
const port = process.env.PORT || 3001;

// A public deployment sets ALLOWED_ORIGINS (comma-separated, e.g. https://treellis.art).
// Without it the server behaves as a local development server and accepts any origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
const PUBLIC_DEPLOY = ALLOWED_ORIGINS.length > 0;

// ---------- 基础中间件 ----------
// 预检 OPTIONS 由 cors 直接返回 204（有的环境里必须显式返回 204 才不会报 Failed to fetch）
app.use(cors({
  origin: PUBLIC_DEPLOY ? ALLOWED_ORIGINS : true,  // 本地允许跨域（来自 Vite 5173）
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Generation-Id', 'X-Generation-Token'],
}));
app.use(express.json({ limit: '20mb' }));        // Nine processed image attachments plus scene context.
app.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({
    code: 'PAYLOAD_TOO_LARGE', error: 'This request is too large. Remove a reference image or use a smaller scene and try again.',
  });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON', error: 'The request contains invalid JSON. Please try again.' });
  next(error);
});

// 简易日志（定位问题很好用）
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------- 静态目录：public/ ----------
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const COMMITS_DIR = path.join(PUBLIC_DIR, 'commits');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(COMMITS_DIR)) fs.mkdirSync(COMMITS_DIR, { recursive: true });

// 禁缓存，开发更顺手
app.use(
  express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: true,
    cacheControl: true,
    maxAge: 0,
  })
);

// ---------- health ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// The generation service checks candidates before returning them to the editor.
// This private development key is outside public/ and is never sent to the browser.
const generationModules = Promise.all([
  import('./src/generation/workflow.mjs'),
  import('./src/generation/config.mjs'),
]);
function trustedLocalRequest(req) {
  if (PUBLIC_DEPLOY) return false;
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (!req.headers.origin) return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.headers.origin).hostname); }
  catch { return false; }
}
function localGenerationKey() {
  const pointer = path.join(__dirname, '.local', 'key-file');
  const file = fs.existsSync(pointer) ? fs.readFileSync(pointer, 'utf8').trim() : '';
  return (file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '') || (process.env.OPENAI_API_KEY || '').trim();
}
async function loadPromptAssets() {
  const [, { ASSET_NAMES }] = await generationModules;
  const pairs = await Promise.all(ASSET_NAMES.map(async (name) => [name,
    await fs.promises.readFile(path.join(PUBLIC_DIR, 'prompts', `${name}.txt`), 'utf8'),
  ]));
  return Object.fromEntries(pairs);
}
app.get('/api/generation/config', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const [, config] = await generationModules;
    const assets = await loadPromptAssets();
    if (Object.values(assets).some((text) => !text.trim())) throw new Error('Missing prompt templates.');
    JSON.parse(assets.jsonCase);
    res.json({ ready: true, model: config.MODEL_ID, efforts: Object.keys(config.RUN_MODES),
      localKeyAvailable: trustedLocalRequest(req) && !!localGenerationKey() });
  } catch {
    res.status(503).json({ ready: false, error: 'The generation service is missing its prompt files. Restore public/prompts and restart the server.' });
  }
});
let activeGenerations = 0;
async function runGenerationInput(input, options) {
  if (input?.mode === 'organize') {
    const { runSmartGrouping } = await import('./src/generation/grouping.mjs');
    return runSmartGrouping(input, options);
  }
  const [{ runGenerationWorkflow }] = await generationModules;
  return runGenerationWorkflow(input, { ...options, loadAssets: loadPromptAssets });
}
const generationJobs = createGenerationJobs({ run: async (input, options) => {
  return runGenerationInput(input, options);
} });

function streamJob(req, res, job, token, after = 0) {
  res.setTimeout(0);
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = event => {
    if (res.destroyed || res.writableEnded) return;
    if (event === null) res.end(); else res.write(`${JSON.stringify(event)}\n`);
  };
  send({ type: 'job', id: job.id });
  const unsubscribe = generationJobs.subscribe(job.id, token, after, send);
  const heartbeat = setInterval(() => send({ type: 'heartbeat', elapsedMs: Date.now() - job.startedAt }), 15000);
  heartbeat.unref?.();
  const detach = () => { clearInterval(heartbeat); unsubscribe?.(); };
  res.once('close', detach);
  // A replay can have finished synchronously before close was registered.
  if (res.writableEnded) detach();
}
app.get('/api/generation/jobs/:id', (req, res) => {
  const token = req.headers['x-generation-token'];
  const job = generationJobs.get(req.params.id, token);
  if (!job) return res.status(404).json({ error: 'This generation session is no longer available. Checked results already received were kept.' });
  const after = Number(req.query.after || 0);
  if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: 'Invalid progress cursor.' });
  streamJob(req, res, job, token, after);
});
app.post('/api/generation/jobs/:id/cancel', (req, res) => {
  if (!generationJobs.cancel(req.params.id, req.headers['x-generation-token'])) return res.status(404).json({ error: 'Generation session unavailable.' });
  res.json({ ok: true });
});
app.post('/api/generate', async (req, res) => {
  const ownKey = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]?.trim();
  const apiKey = ownKey || (trustedLocalRequest(req) ? localGenerationKey() : '');
  if (!apiKey) return res.status(401).json({ error: 'Enter an OpenAI API key in Key settings.' });
  try {
    const { normalizeImages } = await import('./src/generation/imageInputs.mjs');
    normalizeImages(req.body?.images);
  } catch (error) {
    return res.status(error.status || 400).json({ code: error.code || 'INVALID_IMAGES', error: error.message });
  }
  if (req.headers['x-generation-id']) {
    try {
      if (activeGenerations + generationJobs.active >= 2 && !generationJobs.get(req.headers['x-generation-id'], req.headers['x-generation-token']))
        return res.status(429).json({ error: 'Two generations are already running. Please wait or cancel one.' });
      const job = generationJobs.start({ id: req.headers['x-generation-id'], token: req.headers['x-generation-token'], owner: apiKey, input: req.body });
      streamJob(req, res, job, req.headers['x-generation-token']);
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    return;
  }
  if (activeGenerations + generationJobs.active >= 2) return res.status(429).json({ error: 'Two generations are already running. Please wait or cancel one.' });
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  req.on('aborted', cancel);
  res.on('close', cancel);
  activeGenerations++;
  // No model execution deadline. Keep the connection alive until completion or Stop.
  res.setTimeout(0);
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event) => { if (!controller.signal.aborted && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  const requestStarted = Date.now();
  const heartbeat = setInterval(() => send({ type: 'heartbeat', elapsedMs: Date.now() - requestStarted }), 15000);
  heartbeat.unref?.();
  try {
    const output = await runGenerationInput(req.body, { apiKey, signal: controller.signal,
      onProgress: (progress) => send({ type: 'progress', ...progress }),
      onCheckpoint: (checkpoint) => send({ type: 'checkpoint', ...checkpoint }) });
    send({ type: 'result', ...output });
  } catch (error) {
    if (error.name !== 'AbortError') send(publicError(error));
  } finally {
    clearInterval(heartbeat);
    activeGenerations--;
    req.off('aborted', cancel);
    res.off('close', cancel);
    if (!res.writableEnded) res.end();
  }
});

// The draft and commit channels share one scene across every connected client and write
// into public/, so they exist only on a local development server.
if (!PUBLIC_DEPLOY) {
// ---------- 校验 & 工具 ----------
function validateSceneObject(obj) {
  if (!obj || typeof obj !== 'object') return 'scene must be an object';
  const ok =
    'name' in obj || 'operation' in obj || 'children' in obj || 'primitive' in obj;
  return ok ? null : 'scene missing essential fields';
}

function extractRoot(incoming) {
  return incoming && typeof incoming === 'object' && incoming.scene
    ? incoming.scene
    : incoming;
}

// ---------- DRAFT CHANNEL (in-memory + SSE) ----------
let lastDraft = null;
const sseClients = new Set();

function sendToAll(payloadObj) {
  const data = `data: ${JSON.stringify(payloadObj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      // 忽略断开的连接
    }
  }
}

// POST /api/draft : 接收草稿（内存），并广播给所有 SSE 客户端
app.post('/api/draft', (req, res) => {
  try {
    const sceneObj = extractRoot(req.body || {});
    const err = validateSceneObject(sceneObj);
    if (err) return res.status(400).json({ ok: false, error: err });

    lastDraft = sceneObj;
    sendToAll({ scene: lastDraft });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[draft] error:', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/draft/latest : 调试用
app.get('/api/draft/latest', (_req, res) => {
  if (!lastDraft) return res.status(404).json({ ok: false, error: 'no draft yet' });
  return res.json({ ok: true, scene: lastDraft });
});

// GET /api/draft/stream : SSE 通道
app.get('/api/draft/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  // 立即回应，建立流
  res.flushHeaders?.();
  res.write(': connected\n\n');

  sseClients.add(res);

  // 若已有草稿，立刻推送一次（前端无需手动“Load Draft”）
  if (lastDraft) {
    res.write(`data: ${JSON.stringify({ scene: lastDraft })}\n\n`);
  }

  // 心跳，防止代理断开
  const hb = setInterval(() => {
    try {
      res.write(': hb\n\n');
    } catch {}
  }, 15000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(res);
    try {
      res.end();
    } catch {}
  });
});

// ---------- COMMIT (保存到 public/scene.json + commits 快照) ----------
app.post('/api/commit', (req, res) => {
  try {
    const sceneObj = extractRoot(req.body || {});
    const err = validateSceneObject(sceneObj);
    if (err) return res.status(400).json({ ok: false, error: err });

    const wrapped = JSON.stringify({ scene: sceneObj }, null, 2);

    // 覆盖正式文件
    const scenePath = path.join(PUBLIC_DIR, 'scene.json');
    fs.writeFileSync(scenePath, wrapped, 'utf8');

    // 另存为快照
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const commitId = `scene_${ts}.json`;
    const commitPath = path.join(COMMITS_DIR, commitId);
    fs.writeFileSync(commitPath, wrapped, 'utf8');

    // 可选：保存后也广播一次（多窗口同时更新）
    sendToAll({ scene: sceneObj });

    return res.json({ ok: true, commitId });
  } catch (e) {
    console.error('[commit] error:', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});
}

// HOST=127.0.0.1 keeps the port private behind a reverse proxy; unset listens on all interfaces.
app.listen(port, process.env.HOST, () => {
  console.log(`🚀 Server running at http://${process.env.HOST || 'localhost'}:${port}`);
  if (PUBLIC_DEPLOY) console.log(`🌐 Public deployment for ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`📁 Static from ${PUBLIC_DIR}`);
});
