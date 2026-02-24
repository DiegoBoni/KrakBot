'use strict'

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  currentStep: 1,
  config: {
    token: '',
    authorizedUsers: '',
    defaultAgent: 'claude',
    claudeModel: 'claude-sonnet-4-6',
    geminiModel: 'gemini-2.5-pro',
    codexModel: 'gpt-5.2-codex',
    timeout: 120000,
    debug: false,
  },
  cliStatus: { claude: null, gemini: null, codex: null },
  envExists: false,
  hasGit: false,
  npmInstallDone: false,
  botUsername: null,
}

// Detect port from current URL (bootstrap may use 7337-7339)
const BASE = window.location.origin

// ─── Utilities ───────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id) }

function appendTerminal(id, line) {
  const box = $(id)
  if (!box) return
  box.hidden = false
  const div = document.createElement('div')
  div.textContent = line
  box.appendChild(div)
  box.scrollTop = box.scrollHeight
}

function clearTerminal(id) {
  const box = $(id)
  if (!box) return
  box.innerHTML = ''
  box.hidden = true
}

// ─── SSE streaming ────────────────────────────────────────────────────────────
async function streamSSE(url, body, onLine, onDone) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()
      for (const part of parts) {
        const line = part.replace(/^data: /, '')
        if (line === '__DONE__') { onDone(); return }
        if (line.trim()) onLine(line)
      }
    }
    onDone()
  } catch (err) {
    onLine(`ERROR: ${err.message}`)
    onDone()
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function updateProgress(step) {
  document.querySelectorAll('.progress-dot').forEach((dot) => {
    const n = parseInt(dot.dataset.step)
    dot.classList.remove('active', 'done')
    if (n < step) dot.classList.add('done')
    else if (n === step) dot.classList.add('active')
  })
  for (let i = 1; i <= 6; i++) {
    const line = $(`line-${i}-${i + 1}`)
    if (line) {
      line.classList.toggle('done', i < step)
    }
  }
}

// ─── Step navigation ──────────────────────────────────────────────────────────
function goToStep(n) {
  const current = document.querySelector('.step.active')
  if (current) current.classList.remove('active')

  const next = document.querySelector(`.step[data-step="${n}"]`)
  if (next) next.classList.add('active')

  state.currentStep = n
  updateProgress(n)
  window.scrollTo({ top: 0, behavior: 'smooth' })
  onEnterStep(n)
}

function onEnterStep(n) {
  switch (n) {
    case 1: enterStep1(); break
    case 2: enterStep2(); break
    case 3: enterStep3(); break
    case 4: enterStep4(); break
    case 5: enterStep5(); break
    case 6: enterStep6(); break
    case 7: enterStep7(); break
  }
}

// ─── Step 1: Bienvenida ───────────────────────────────────────────────────────
function enterStep1() {
  if (state.envExists) {
    $('banner-reconfig').hidden = false
  }
}

// ─── Step 2: Entorno ──────────────────────────────────────────────────────────
async function enterStep2() {
  try {
    const res = await fetch(`${BASE}/api/status`)
    const data = await res.json()

    // Node.js
    const nodeItem = $('node-status')
    const nodeDetail = $('node-detail')
    const nodeIcon = nodeItem.querySelector('.check-icon')
    nodeIcon.textContent = '✅'
    nodeDetail.textContent = data.nodeVersion

    // npm
    const npmItem = $('npm-status')
    const npmDetail = $('npm-detail')
    const npmIcon = npmItem.querySelector('.check-icon')
    if (data.npmVersion) {
      npmIcon.textContent = '✅'
      npmDetail.textContent = `v${data.npmVersion}`
    } else {
      npmIcon.textContent = '❌'
      npmDetail.textContent = 'no encontrado'
    }

    state.envExists = data.envExists
    state.hasGit = data.hasGit

    // Git section
    if (data.hasGit) {
      $('git-update-section').hidden = false
    }

    // If npm install was already done (re-entering step), enable next
    if (state.npmInstallDone) {
      $('btn-step2-next').disabled = false
    }
  } catch (err) {
    console.error('Error fetching status:', err)
  }
}

// ─── Step 3: Token ────────────────────────────────────────────────────────────
async function enterStep3() {
  if (state.envExists) {
    await loadExistingEnv()
  }

  // Real-time token validation
  const tokenInput = $('telegram-token')
  tokenInput.addEventListener('input', () => {
    validateToken(tokenInput.value)
  }, { once: false })
}

function validateToken(value) {
  const tokenInput = $('telegram-token')
  const feedback = $('token-feedback')
  const trimmed = value.trim()

  if (!trimmed) {
    tokenInput.classList.remove('valid', 'invalid')
    feedback.textContent = ''
    feedback.className = 'input-feedback'
    return
  }

  const valid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(trimmed)
  if (valid) {
    tokenInput.classList.remove('invalid')
    tokenInput.classList.add('valid')
    feedback.textContent = '✅ Formato válido'
    feedback.className = 'input-feedback ok'
  } else {
    tokenInput.classList.remove('valid')
    tokenInput.classList.add('invalid')
    feedback.textContent = '⚠️ Formato inusual — verificá que copiaste bien el token'
    feedback.className = 'input-feedback warn'
  }
}

async function loadExistingEnv() {
  try {
    const res = await fetch(`${BASE}/api/env-current`)
    const env = await res.json()

    if (env.TELEGRAM_TOKEN) {
      // Don't overwrite with masked version — keep empty and show hint
      $('telegram-token').placeholder = `Token actual: ${env.TELEGRAM_TOKEN} (ingresá el nuevo o dejá vacío para mantener)`
    }
    if (env.AUTHORIZED_USERS) $('authorized-users').value = env.AUTHORIZED_USERS
    if (env.DEFAULT_AGENT)    { const s = $('default-agent'); if (s) s.value = env.DEFAULT_AGENT }
    if (env.CLAUDE_MODEL)     { const s = $('model-claude');  if (s) s.value = env.CLAUDE_MODEL }
    if (env.GEMINI_MODEL)     { const s = $('model-gemini');  if (s) s.value = env.GEMINI_MODEL }
    if (env.CODEX_MODEL)      { const s = $('model-codex');   if (s) s.value = env.CODEX_MODEL }
    if (env.CLI_TIMEOUT)      {
      const slider = $('timeout-slider')
      if (slider) {
        slider.value = env.CLI_TIMEOUT
        $('timeout-label').textContent = `${Math.round(parseInt(env.CLI_TIMEOUT) / 1000)}s`
      }
    }
    if (env.DEBUG)            { const t = $('debug-toggle'); if (t) t.checked = env.DEBUG === 'true' }
  } catch (err) {
    console.warn('No se pudo cargar el .env actual:', err)
  }
}

// ─── Step 4: Agentes ──────────────────────────────────────────────────────────
async function enterStep4() {
  await checkAllCLIs()
}

async function checkAllCLIs() {
  const agents = ['claude', 'gemini', 'codex']
  await Promise.all(agents.map((name) => checkOneCLI(name)))
}

async function checkOneCLI(name) {
  try {
    const res = await fetch(`${BASE}/api/check-cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    state.cliStatus[name] = data
    updateAgentCard(name, data)
  } catch (err) {
    state.cliStatus[name] = { found: false }
    updateAgentCard(name, { found: false })
  }
}

function updateAgentCard(name, status) {
  const badge = $(`badge-${name}`)
  const card = $(`card-${name}`)
  const btnInstall = $(`btn-install-${name}`)
  const authInstruction = $(`auth-${name}`)
  const authRow = $(`row-auth-${name}`)
  const selectRow = $(`select-row-${name}`)

  if (status.found) {
    badge.textContent = `✅ Instalado${status.version ? ' — ' + status.version : ''}`
    badge.className = 'badge badge-ok'
    card.classList.add('status-ok')
    card.classList.remove('status-error')
    btnInstall.hidden = true
    authInstruction.hidden = false
    authRow.hidden = false
    selectRow.hidden = false
  } else {
    badge.textContent = '❌ No instalado'
    badge.className = 'badge badge-error'
    card.classList.add('status-error')
    card.classList.remove('status-ok')
    btnInstall.hidden = false
    authInstruction.hidden = true
    authRow.hidden = true
    selectRow.hidden = true
  }
}

function setupInstallCLI(name, pkg) {
  const btn = $(`btn-install-${name}`)
  if (!btn) return

  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Instalando...'
    clearTerminal(`terminal-${name}`)

    let hasEacces = false
    await streamSSE(
      `${BASE}/api/install-cli`,
      { package: pkg },
      (line) => {
        appendTerminal(`terminal-${name}`, line)
        if (line.includes('EACCES') || line.includes('permission denied')) hasEacces = true
      },
      async () => {
        if (hasEacces) {
          appendTerminal(`terminal-${name}`, '⚠️ Error de permisos. Intentá con: sudo npm install -g ' + pkg)
          appendTerminal(`terminal-${name}`, '    O usá nvm para evitar sudo: https://github.com/nvm-sh/nvm')
        }
        btn.textContent = 'Reintentar'
        btn.disabled = false
        // Re-check if install succeeded
        await checkOneCLI(name)
        validateAgentStep()
      }
    )
  })
}

function validateAgentStep() {
  const agents = ['claude', 'gemini', 'codex']
  const warning = $('agents-warning')

  const anyReady = agents.some((name) => {
    const installed = state.cliStatus[name]?.found
    const authed = $(`auth-check-${name}`)?.checked
    return installed && authed
  })

  $('btn-step4-next').disabled = false // allow continue regardless — just warn
  warning.style.display = anyReady ? 'none' : 'block'
}

// ─── Step 5: Config ───────────────────────────────────────────────────────────
function enterStep5() {
  const slider = $('timeout-slider')
  slider.addEventListener('input', () => {
    $('timeout-label').textContent = `${Math.round(parseInt(slider.value) / 1000)}s`
  })
}

// ─── Step 6: Resumen ──────────────────────────────────────────────────────────
function enterStep6() {
  const config = buildConfig()
  state.config = config

  // Summary list
  const summary = $('config-summary')
  const items = [
    ['Token', maskToken(config.token)],
    ['Usuarios autorizados', config.authorizedUsers || 'Todos'],
    ['Agente por defecto', config.defaultAgent],
    ['Modelo Claude', config.claudeModel],
    ['Modelo Gemini', config.geminiModel],
    ['Modelo Codex', config.codexModel || 'default CLI'],
    ['Timeout', `${Math.round(config.timeout / 1000)}s`],
    ['Debug', config.debug ? 'Activado' : 'Desactivado'],
  ]

  summary.innerHTML = items.map(([k, v]) =>
    `<li><span class="cs-key">${k}</span><span class="cs-value">${v}</span></li>`
  ).join('')

  // Env preview
  $('env-preview').textContent = buildEnvPreview(config)
}

function buildConfig() {
  return {
    token:          $('telegram-token').value.trim() || state.config.token,
    authorizedUsers: $('authorized-users').value.trim(),
    defaultAgent:   $('default-agent').value || 'claude',
    claudeModel:    $('model-claude').value || 'claude-sonnet-4-6',
    geminiModel:    $('model-gemini').value || 'gemini-2.5-pro',
    codexModel:     $('model-codex').value || 'gpt-5.2-codex',
    timeout:        parseInt($('timeout-slider').value) || 120000,
    debug:          $('debug-toggle').checked,
  }
}

function maskToken(token) {
  if (!token) return '(no configurado)'
  const colonIdx = token.indexOf(':')
  if (colonIdx === -1) return '****'
  return token.slice(0, colonIdx + 1) + '****'
}

function buildEnvPreview(config) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `# Generado por KrakBot Installer — ${ts}

TELEGRAM_TOKEN=${maskToken(config.token)}

DEFAULT_AGENT=${config.defaultAgent}
AUTHORIZED_USERS=${config.authorizedUsers || ''}

CLI_TIMEOUT=${config.timeout}
DEBUG=${config.debug}

CLAUDE_CLI_PATH=claude
GEMINI_CLI_PATH=gemini
CODEX_CLI_PATH=codex

CLAUDE_MODEL=${config.claudeModel}
GEMINI_MODEL=${config.geminiModel}
CODEX_MODEL=${config.codexModel || 'gpt-5.2-codex'}

MAX_RESPONSE_LENGTH=4000`
}

// ─── Step 7: Arranque ─────────────────────────────────────────────────────────
async function enterStep7() {
  const terminal = $('terminal-start')
  terminal.hidden = false

  appendTerminal('terminal-start', '📝 Escribiendo .env...')

  try {
    const writeRes = await fetch(`${BASE}/api/write-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: state.config }),
    })
    const writeData = await writeRes.json()
    if (!writeData.ok) throw new Error('No se pudo escribir el .env')
    appendTerminal('terminal-start', '✅ .env creado correctamente')
  } catch (err) {
    appendTerminal('terminal-start', `❌ Error: ${err.message}`)
    return
  }

  // Fetch bot username in background (for the Telegram button)
  if (state.config.token) {
    fetchBotUsername(state.config.token)
  }

  appendTerminal('terminal-start', '')
  appendTerminal('terminal-start', '🚀 Iniciando KrakBot (npm start)...')
  appendTerminal('terminal-start', '')

  let botStarted = false

  await streamSSE(
    `${BASE}/api/start-bot`,
    null,
    (line) => {
      appendTerminal('terminal-start', line)
      // Detect successful start patterns
      if (line.includes('polling') || line.includes('listening') || line.includes('KrakBot') || line.includes('started')) {
        botStarted = true
      }
    },
    () => {
      appendTerminal('terminal-start', '')
      appendTerminal('terminal-start', '─────────────────────────────────')

      $('success-msg').hidden = false
      $('pm2-details').hidden = false

      if (state.botUsername) {
        const btnBot = $('btn-open-bot')
        btnBot.href = `https://t.me/${state.botUsername}`
        btnBot.hidden = false
      }
    }
  )
}

async function fetchBotUsername(token) {
  try {
    const res = await fetch(`${BASE}/api/bot-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json()
    if (data.username) {
      state.botUsername = data.username
      const btnBot = $('btn-open-bot')
      btnBot.href = `https://t.me/${data.username}`
      btnBot.hidden = false
    }
  } catch (err) {
    console.warn('No se pudo obtener el username del bot:', err)
  }
}

// ─── Init & event listeners ───────────────────────────────────────────────────
async function init() {
  // Load initial status
  try {
    const res = await fetch(`${BASE}/api/status`)
    const data = await res.json()
    state.envExists = data.envExists
    state.hasGit = data.hasGit
  } catch {}

  // Step 1
  $('btn-start').addEventListener('click', () => goToStep(2))

  // Step 2
  $('btn-git-pull').addEventListener('click', () => {
    clearTerminal('terminal-git')
    $('btn-git-pull').disabled = true
    streamSSE(
      `${BASE}/api/git-pull`, null,
      (line) => appendTerminal('terminal-git', line),
      () => { $('btn-git-pull').disabled = false }
    )
  })

  $('btn-npm-install').addEventListener('click', () => {
    $('btn-npm-install').disabled = true
    $('npm-install-status').textContent = 'Instalando...'
    clearTerminal('terminal-npm')
    streamSSE(
      `${BASE}/api/npm-install`, null,
      (line) => appendTerminal('terminal-npm', line),
      () => {
        $('npm-install-status').textContent = '✅ Listo'
        state.npmInstallDone = true
        $('btn-step2-next').disabled = false
        $('btn-npm-install').textContent = 'Reinstalar'
        $('btn-npm-install').disabled = false
      }
    )
  })

  $('btn-step2-next').addEventListener('click', () => goToStep(3))

  // Step 3
  $('btn-toggle-token').addEventListener('click', () => {
    const input = $('telegram-token')
    const isPass = input.type === 'password'
    input.type = isPass ? 'text' : 'password'
    $('btn-toggle-token').textContent = isPass ? '🙈' : '👁'
  })

  $('btn-step3-back').addEventListener('click', () => goToStep(2))
  $('btn-step3-next').addEventListener('click', () => {
    const token = $('telegram-token').value.trim()
    if (token) state.config.token = token
    goToStep(4)
  })

  // Step 4 — setup install handlers
  setupInstallCLI('claude', '@anthropic-ai/claude-code')
  setupInstallCLI('gemini', '@google/gemini-cli')
  setupInstallCLI('codex',  '@openai/codex')

  ;['claude', 'gemini', 'codex'].forEach((name) => {
    const cb = $(`auth-check-${name}`)
    if (cb) cb.addEventListener('change', validateAgentStep)
  })

  $('btn-step4-back').addEventListener('click', () => goToStep(3))
  $('btn-step4-next').addEventListener('click', () => {
    const agents = ['claude', 'gemini', 'codex']
    const anyReady = agents.some((name) => {
      return state.cliStatus[name]?.found && $(`auth-check-${name}`)?.checked
    })
    if (!anyReady) {
      $('agents-warning').style.display = 'block'
      // Allow continue anyway after warning
    }
    goToStep(5)
  })

  // Step 5
  $('btn-step5-back').addEventListener('click', () => goToStep(4))
  $('btn-step5-next').addEventListener('click', () => goToStep(6))

  // Step 6
  $('btn-step6-back').addEventListener('click', () => goToStep(5))
  $('btn-confirm').addEventListener('click', () => {
    state.config = buildConfig()
    goToStep(7)
  })

  // Step 7
  $('btn-shutdown').addEventListener('click', async () => {
    try {
      await fetch(`${BASE}/api/shutdown`, { method: 'POST' })
    } catch {}
    setTimeout(() => window.close(), 600)
  })

  // Start at step 1
  goToStep(1)
}

document.addEventListener('DOMContentLoaded', init)
