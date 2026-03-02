'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const os = require('os')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const UI_DIR = path.join(__dirname, 'ui')

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
}

// ─── Port detection ───────────────────────────────────────────────────────────
function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(err)
      else reject(err)
    })
    server.listen(port, '127.0.0.1', () => resolve(port))
  })
}

async function findPort(server) {
  const candidates = [7337, 7338, 7339]
  for (const port of candidates) {
    try {
      return await tryListen(server, port)
    } catch {
      server.removeAllListeners('error')
    }
  }
  throw new Error('Puertos 7337-7339 ocupados. Liberá uno e intentá de nuevo.')
}

// ─── Open browser ─────────────────────────────────────────────────────────────
function openBrowser(url) {
  const platform = os.platform()
  try {
    if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' })
    else if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore', shell: true })
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' })
  } catch {
    console.log(`  Abrí manualmente: ${url}`)
  }
}

// ─── Static file server ───────────────────────────────────────────────────────
function serveStatic(req, res, port) {
  let urlPath = req.url.split('?')[0]
  if (urlPath === '/') urlPath = '/index.html'

  const filePath = path.join(UI_DIR, urlPath)

  // Prevent path traversal
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': `http://localhost:${port}`,
    })
    res.end(data)
  })
}

// ─── Body reader ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ─── SSE streaming ────────────────────────────────────────────────────────────
function streamCommand(req, res, command, args, cwd) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  const child = spawn(command, args, { cwd, shell: false })

  const sendLine = (line) => {
    const lines = line.toString().split('\n')
    for (const l of lines) {
      if (l.trim()) res.write(`data: ${l}\n\n`)
    }
  }

  child.stdout.on('data', sendLine)
  child.stderr.on('data', sendLine)

  child.on('close', (code) => {
    if (code !== 0) res.write(`data: [Proceso terminó con código ${code}]\n\n`)
    res.write('data: __DONE__\n\n')
    res.end()
  })

  child.on('error', (err) => {
    res.write(`data: ERROR: ${err.message}\n\n`)
    res.write('data: __DONE__\n\n')
    res.end()
  })

  req && req.on && req.on('close', () => { try { child.kill() } catch {} })
}

// ─── .env helpers ─────────────────────────────────────────────────────────────
function parseEnv(filePath) {
  const result = {}
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      result[key] = value
    }
  } catch {
    // file doesn't exist
  }
  return result
}

function maskToken(token) {
  if (!token) return ''
  const colonIdx = token.indexOf(':')
  if (colonIdx === -1) return '****'
  return token.slice(0, colonIdx + 1) + '****'
}

function writeEnv(config) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const audioBlock = config.includeAudio ? `
# Audio transcription (mlx-whisper)
WHISPER_MODEL=${config.whisperModel || 'mlx-community/whisper-base-mlx'}
WHISPER_LANGUAGE=${config.whisperLanguage || 'es'}
AUDIO_TEMP_DIR=/tmp/krakbot-audio
MAX_AUDIO_SIZE_MB=25
` : ''
  return `# Generado por KrakBot Installer — ${ts}

TELEGRAM_TOKEN=${config.token || ''}

DEFAULT_AGENT=${config.defaultAgent || 'claude'}
AUTHORIZED_USERS=${config.authorizedUsers || ''}

DEBUG=${config.debug || false}

CLI_TIMEOUT=120000

CLAUDE_CLI_PATH=claude
GEMINI_CLI_PATH=gemini
CODEX_CLI_PATH=codex

CLAUDE_MODEL=${config.claudeModel || 'claude-sonnet-4-6'}
GEMINI_MODEL=${config.geminiModel || 'gemini-2.5-pro'}
CODEX_MODEL=${config.codexModel || ''}

MAX_RESPONSE_LENGTH=4000

# Personalization — soul & memories
SOUL_PATH=./data/SOUL.md
MEMORY_INJECT=recent
MEMORY_INJECT_LIMIT=2000

# Conversational memory
HISTORY_WINDOW=6
SESSION_TTL_HOURS=0
${audioBlock}
# Auto-update desde GitHub
GITHUB_REPO=DiegoBoni/KrakBot
GITHUB_BRANCH=main
UPDATE_CHECK_INTERVAL_HOURS=24
NOTIFY_CHAT_ID=
GITHUB_TOKEN=
PM2_APP_NAME=krakbot

# Custom Agents
ROOT_AGENT_CLI=claude
`
}

// ─── JSON response helper ─────────────────────────────────────────────────────
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

// ─── CLI check ────────────────────────────────────────────────────────────────
function checkCLI(name) {
  try {
    const isWindows = os.platform() === 'win32'
    const whichCmd = isWindows ? 'where' : 'which'
    const cliPath = execSync(`${whichCmd} ${name}`, { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim().split('\n')[0]

    let version = ''
    try {
      version = execSync(`${name} --version`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 })
        .toString().trim().split('\n')[0]
    } catch {}

    return { found: true, path: cliPath, version }
  } catch {
    return { found: false, path: null, version: null }
  }
}

// ─── Telegram getMe ───────────────────────────────────────────────────────────
async function getTelegramUsername(token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${token}/getMe`)
    const mod = require('https')
    mod.get(url.href, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString())
          if (data.ok) resolve(data.result.username)
          else reject(new Error(data.description || 'Telegram error'))
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// ─── Sequential SSE helper ────────────────────────────────────────────────────
function spawnAndStream(res, command, args, cwd, { silent } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false })
    const emit = (d) => {
      if (silent) return
      d.toString().split('\n').filter(l => l.trim()).forEach(l => res.write(`data: ${l}\n\n`))
    }
    child.stdout.on('data', emit)
    child.stderr.on('data', emit)
    child.on('close', resolve)
    child.on('error', (err) => { res.write(`data: ERROR: ${err.message}\n\n`); resolve(1) })
  })
}

// ─── Router ───────────────────────────────────────────────────────────────────
async function router(req, res, port) {
  const { method, url } = req
  const pathname = url.split('?')[0]

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end()
    return
  }

  // ── GET /api/status ─────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/status') {
    let nodeVersion = process.version
    let npmVersion = ''
    try { npmVersion = execSync('npm --version', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim() } catch {}

    const envExists = fs.existsSync(path.join(PROJECT_ROOT, '.env'))
    const hasGit = fs.existsSync(path.join(PROJECT_ROOT, '.git'))

    const clisFound = {
      claude: checkCLI('claude').found,
      gemini: checkCLI('gemini').found,
      codex:  checkCLI('codex').found,
    }

    const audioTools = {
      ffmpeg:     checkCLI('ffmpeg').found,
      mlxWhisper: checkCLI('mlx_whisper').found,
    }

    sendJSON(res, { nodeVersion, npmVersion, envExists, hasGit, clisFound, arch: os.arch(), platform: os.platform(), audioTools })
    return
  }

  // ── GET /api/env-current ────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/env-current') {
    const envPath = path.join(PROJECT_ROOT, '.env')
    const env = parseEnv(envPath)
    if (env.TELEGRAM_TOKEN) env.TELEGRAM_TOKEN = maskToken(env.TELEGRAM_TOKEN)
    sendJSON(res, env)
    return
  }

  // ── POST /api/git-pull ──────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/git-pull') {
    streamCommand(req, res, 'git', ['pull'], PROJECT_ROOT)
    return
  }

  // ── POST /api/npm-install ───────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/npm-install') {
    if (!fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' })
      res.write(`data: ❌ package.json no encontrado en ${PROJECT_ROOT}\n\n`)
      res.write('data: Intentá volver a clonar el repositorio: git clone https://github.com/DiegoBoni/KrakBot ~/.krakbot\n\n')
      res.write('data: __DONE__\n\n')
      res.end()
      return
    }
    streamCommand(req, res, 'npm', ['install'], PROJECT_ROOT)
    return
  }

  // ── POST /api/check-cli ─────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/check-cli') {
    const body = await readBody(req)
    let name = ''
    try { name = JSON.parse(body).name } catch {}
    if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
      sendJSON(res, { error: 'Invalid name' }, 400)
      return
    }
    sendJSON(res, checkCLI(name))
    return
  }

  // ── POST /api/install-cli ───────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/install-cli') {
    const body = await readBody(req)
    let pkg = ''
    try { pkg = JSON.parse(body).package } catch {}
    if (!pkg || !/^[@a-z0-9/_.-]+$/i.test(pkg)) {
      sendJSON(res, { error: 'Invalid package name' }, 400)
      return
    }
    streamCommand(req, res, 'npm', ['install', '-g', pkg], PROJECT_ROOT)
    return
  }

  // ── POST /api/write-env ─────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/write-env') {
    const body = await readBody(req)
    let config = {}
    try { config = JSON.parse(body).config } catch {}

    const envPath = path.join(PROJECT_ROOT, '.env')
    const content = writeEnv(config)
    fs.writeFileSync(envPath, content, 'utf8')

    // chmod 600 on Unix
    if (os.platform() !== 'win32') {
      try { fs.chmodSync(envPath, 0o600) } catch {}
    }

    sendJSON(res, { ok: true })
    return
  }

  // ── POST /api/start-bot ─────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/start-bot') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const isWindows = os.platform() === 'win32'
    const whichCmd = isWindows ? 'where' : 'which'

    // 1. Check pm2
    const pm2CheckCode = await spawnAndStream(res, whichCmd, ['pm2'], PROJECT_ROOT, { silent: true })
    if (pm2CheckCode !== 0) {
      res.write('data: ⚠️ pm2 no encontrado. Instalando...\n\n')
      const installCode = await spawnAndStream(res, 'npm', ['install', '-g', 'pm2'], PROJECT_ROOT)
      if (installCode !== 0) {
        res.write('data: ❌ Error instalando pm2. Intentá: sudo npm install -g pm2\n\n')
        res.write('data: __DONE__\n\n')
        res.end()
        return
      }
    }

    // 2. Delete any existing krakbot instances to avoid duplicates (silent — ok if none exist)
    await spawnAndStream(res, 'pm2', ['delete', 'krakbot'], PROJECT_ROOT, { silent: true })

    // 3. Fresh start (always clean)
    res.write('data: 🚀 Iniciando KrakBot con pm2...\n\n')
    await spawnAndStream(res, 'pm2', ['start', 'npm', '--name', 'krakbot', '--', 'start'], PROJECT_ROOT)

    res.write('data: __DONE__\n\n')
    res.end()
    return
  }

  // ── POST /api/setup-autostart ────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/setup-autostart') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const SUDO_RE = /sudo\s+env\s+PATH|sudo\s+systemctl|sudo\s+launchctl/

    const streamCmd = (command, args) => new Promise((resolve) => {
      const child = spawn(command, args, { cwd: PROJECT_ROOT, shell: false })
      const emit = (d) => {
        d.toString().split('\n').forEach((line) => {
          if (!line.trim()) return
          if (SUDO_RE.test(line)) {
            res.write(`data: SUDO_CMD: ${line}\n\n`)
          } else {
            res.write(`data: ${line}\n\n`)
          }
        })
      }
      child.stdout.on('data', emit)
      child.stderr.on('data', emit)
      child.on('close', resolve)
      child.on('error', (err) => { res.write(`data: ERROR: ${err.message}\n\n`); resolve(1) })
    })

    await streamCmd('pm2', ['save'])
    await streamCmd('pm2', ['startup'])

    res.write('data: __DONE__\n\n')
    res.end()
    return
  }

  // ── POST /api/bot-username ──────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/bot-username') {
    const body = await readBody(req)
    let token = ''
    try { token = JSON.parse(body).token } catch {}
    if (!token) { sendJSON(res, { error: 'No token' }, 400); return }

    try {
      const username = await getTelegramUsername(token)
      sendJSON(res, { username })
    } catch (err) {
      sendJSON(res, { error: err.message }, 500)
    }
    return
  }

  // ── POST /api/install-audio ─────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/install-audio') {
    const body = await readBody(req)
    let tool = ''
    try { tool = JSON.parse(body).tool } catch {}
    if (!['ffmpeg', 'mlx-whisper'].includes(tool)) {
      sendJSON(res, { error: 'Invalid tool' }, 400)
      return
    }
    if (tool === 'mlx-whisper' && os.arch() !== 'arm64') {
      sendJSON(res, { error: 'not-supported' }, 400)
      return
    }

    let command, args
    const platform = os.platform()
    if (tool === 'ffmpeg') {
      if (platform === 'darwin')           { command = 'brew';    args = ['install', 'ffmpeg'] }
      else if (checkCLI('apt-get').found)  { command = 'apt-get'; args = ['install', '-y', 'ffmpeg'] }
      else if (checkCLI('dnf').found)      { command = 'dnf';     args = ['install', '-y', 'ffmpeg'] }
      else if (checkCLI('yum').found)      { command = 'yum';     args = ['install', '-y', 'ffmpeg'] }
      else { sendJSON(res, { error: 'no-package-manager' }, 400); return }
    } else {
      command = 'pip3'
      args = ['install', '--break-system-packages', 'mlx-whisper']
    }

    streamCommand(req, res, command, args, PROJECT_ROOT)
    return
  }

  // ── POST /api/shutdown ──────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/shutdown') {
    sendJSON(res, { ok: true })
    setTimeout(() => process.exit(0), 500)
    return
  }

  // ── Static files ─────────────────────────────────────────────────────────────
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    serveStatic(req, res, port)
    return
  }

  // ── 404 ──────────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const server = http.createServer((req, res) => {
    router(req, res, server._port).catch((err) => {
      console.error('Router error:', err)
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      } catch {}
    })
  })

  const port = await findPort(server)
  server._port = port

  const url = `http://localhost:${port}`
  console.log('')
  console.log('  🐙⚡ KrakBot Installer')
  console.log(`  Corriendo en ${url}`)
  console.log('  Ctrl+C para detener')
  console.log('')

  openBrowser(url)
}

main().catch((err) => {
  console.error('Error fatal:', err.message)
  process.exit(1)
})
