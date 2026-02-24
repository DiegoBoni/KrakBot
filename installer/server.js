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
function streamCommand(res, command, args, cwd) {
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
  return `# Generado por KrakBot Installer — ${ts}

TELEGRAM_TOKEN=${config.token || ''}

DEFAULT_AGENT=${config.defaultAgent || 'claude'}
AUTHORIZED_USERS=${config.authorizedUsers || ''}

CLI_TIMEOUT=${config.timeout || 120000}
DEBUG=${config.debug || false}

CLAUDE_CLI_PATH=claude
GEMINI_CLI_PATH=gemini
CODEX_CLI_PATH=codex

CLAUDE_MODEL=${config.claudeModel || 'claude-sonnet-4-6'}
GEMINI_MODEL=${config.geminiModel || 'gemini-2.5-pro'}
CODEX_MODEL=${config.codexModel || 'gpt-5.2-codex'}

MAX_RESPONSE_LENGTH=4000
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

    sendJSON(res, { nodeVersion, npmVersion, envExists, hasGit, clisFound })
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

    const child = spawn('npm', ['start'], { cwd: PROJECT_ROOT, shell: false })
    let success = false
    const timeout = setTimeout(() => {
      success = true
      res.write('data: __DONE__\n\n')
      res.end()
      // Don't kill — leave bot running
    }, 15000)

    const sendLine = (line) => {
      const lines = line.toString().split('\n')
      for (const l of lines) {
        if (l.trim()) res.write(`data: ${l}\n\n`)
      }
    }

    child.stdout.on('data', sendLine)
    child.stderr.on('data', sendLine)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (!success) {
        res.write(`data: [Bot terminó con código ${code}]\n\n`)
        res.write('data: __DONE__\n\n')
        res.end()
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      res.write(`data: ERROR: ${err.message}\n\n`)
      res.write('data: __DONE__\n\n')
      res.end()
    })

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
