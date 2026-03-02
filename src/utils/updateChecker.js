const { execSync } = require('child_process')
const { existsSync, writeFileSync, readFileSync, unlinkSync } = require('fs')
const path = require('path')
const logger = require('./logger')

const ROOT_DIR     = path.resolve(__dirname, '../..')
const PENDING_FILE = path.join(ROOT_DIR, 'data', '.update-pending.json')

// Module-level singleton state
let _bot = null
let _pendingNotification = null  // { sha, msgId, chatId } | null
let _ignoredSha = null

// ─── Config helpers ────────────────────────────────────────────────────────────

function getConfig() {
  const intervalHours = parseFloat(process.env.UPDATE_CHECK_INTERVAL_HOURS)
  return {
    repo:          process.env.GITHUB_REPO   || '',
    branch:        process.env.GITHUB_BRANCH || 'main',
    intervalHours: isNaN(intervalHours) ? 24 : intervalHours,
    pm2App:        process.env.PM2_APP_NAME  || 'krakbot',
    token:         process.env.GITHUB_TOKEN  || '',
  }
}

function getNotifyChatId() {
  if (process.env.NOTIFY_CHAT_ID) return parseInt(process.env.NOTIFY_CHAT_ID)
  const first = (process.env.AUTHORIZED_USERS || '')
    .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))[0]
  return first ?? null
}

// ─── Version detection ─────────────────────────────────────────────────────────

function getLocalSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim()
  } catch (err) {
    logger.warn(`updateChecker: git rev-parse failed — ${err.message}`)
    return null
  }
}

async function getRemoteCommit(repo, branch, token) {
  const url = `https://api.github.com/repos/${repo}/commits/${branch}`
  const headers = {
    'User-Agent': 'KrakBot-AutoUpdater',
    'Accept':     'application/vnd.github.v3+json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  const data = await res.json()
  return {
    sha:     data.sha,
    message: data.commit?.message?.split('\n')[0] ?? '(sin mensaje)',
  }
}

// ─── Notification ──────────────────────────────────────────────────────────────

async function sendUpdateNotification(localSha, remoteSha, commitMsg) {
  const chatId = getNotifyChatId()
  if (!chatId || !_bot) {
    logger.warn('updateChecker: no NOTIFY_CHAT_ID — cannot send notification')
    return
  }

  const text =
    `🔄 *Nueva versión disponible*\n\n` +
    `Commit: \`${remoteSha.slice(0, 7)}\`\n` +
    `Cambio: _${commitMsg}_\n\n` +
    `¿Querés actualizar ahora? ⚠️ El bot se va a reiniciar brevemente.`

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Sí, actualizar', callback_data: 'update_yes'    },
      { text: '⏰ En 1h',          callback_data: 'update_remind'  },
      { text: '❌ Ignorar',        callback_data: 'update_ignore'  },
    ]]
  }

  try {
    const msg = await _bot.telegram.sendMessage(chatId, text, {
      parse_mode:   'Markdown',
      reply_markup: keyboard,
    })
    _pendingNotification = { sha: remoteSha, msgId: msg.message_id, chatId }
    logger.info(`updateChecker: notification sent (${localSha.slice(0, 7)} → ${remoteSha.slice(0, 7)})`)
  } catch (err) {
    logger.error(`updateChecker: failed to send notification — ${err.message}`)
  }
}

// ─── Scheduled check ──────────────────────────────────────────────────────────

async function check() {
  const { repo, branch, token } = getConfig()
  if (!repo) {
    logger.debug('updateChecker: GITHUB_REPO not set — skipping')
    return
  }
  if (_pendingNotification) {
    logger.debug('updateChecker: pending notification — skipping check')
    return
  }

  const localSha = getLocalSha()
  if (!localSha) return

  let remote
  try {
    remote = await getRemoteCommit(repo, branch, token)
  } catch (err) {
    logger.warn(`updateChecker: GitHub unreachable — ${err.message}`)
    return
  }

  if (remote.sha === localSha) {
    logger.debug(`updateChecker: up to date (${localSha.slice(0, 7)})`)
    return
  }
  if (remote.sha === _ignoredSha) {
    logger.debug(`updateChecker: sha ignored (${remote.sha.slice(0, 7)}) — skipping`)
    return
  }

  logger.info(`updateChecker: update available ${localSha.slice(0, 7)} → ${remote.sha.slice(0, 7)}`)
  await sendUpdateNotification(localSha, remote.sha, remote.message)
}

// ─── Update execution ─────────────────────────────────────────────────────────

async function performUpdate() {
  if (!_pendingNotification) return
  const { sha: newSha, msgId, chatId } = _pendingNotification
  const oldSha = getLocalSha() ?? 'unknown'
  const { branch, pm2App } = getConfig()
  _pendingNotification = null

  // Remove buttons and show "updating" status
  if (_bot) {
    await _bot.telegram.editMessageText(chatId, msgId, undefined,
      '⏳ Actualizando… ya vuelvo en unos segundos.',
      { reply_markup: { inline_keyboard: [] } }
    ).catch(() => {})
  }

  // Read package.json before update to detect dependency changes
  const pkgPath = path.join(ROOT_DIR, 'package.json')
  const pkgBefore = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : ''

  // Write pending success file BEFORE pm2 restart (process will be replaced)
  try {
    writeFileSync(PENDING_FILE, JSON.stringify({
      oldSha: oldSha.slice(0, 7),
      newSha:  newSha.slice(0, 7),
      chatId,
    }), 'utf8')
  } catch (err) {
    logger.error(`updateChecker: could not write pending file — ${err.message}`)
  }

  try {
    logger.info('updateChecker: git fetch origin...')
    execSync('git fetch origin', { cwd: ROOT_DIR, timeout: 30_000 })

    logger.info('updateChecker: git reset --hard...')
    execSync(`git reset --hard origin/${branch}`, { cwd: ROOT_DIR, timeout: 30_000 })

    const pkgAfter = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : ''
    if (pkgBefore !== pkgAfter) {
      logger.info('updateChecker: package.json changed — npm install...')
      execSync('npm install --omit=dev', { cwd: ROOT_DIR, timeout: 5 * 60 * 1000, stdio: 'ignore' })
    }

    logger.info(`updateChecker: pm2 restart ${pm2App}...`)
    execSync(`pm2 restart ${pm2App}`, { timeout: 30_000 })
    // Process is replaced by pm2 — execution stops here

  } catch (err) {
    logger.error(`updateChecker: update failed — ${err.message}`)
    try { unlinkSync(PENDING_FILE) } catch {}
    if (_bot) {
      await _bot.telegram.sendMessage(chatId,
        `❌ Error durante la actualización:\n\`${err.message.slice(0, 200)}\``,
        { parse_mode: 'Markdown' }
      ).catch(() => {})
    }
  }
}

// ─── Post-restart boot check ──────────────────────────────────────────────────

async function checkPendingUpdate() {
  if (!existsSync(PENDING_FILE)) return
  let data
  try {
    data = JSON.parse(readFileSync(PENDING_FILE, 'utf8'))
    unlinkSync(PENDING_FILE)
  } catch (err) {
    logger.error(`updateChecker: error reading pending file — ${err.message}`)
    try { unlinkSync(PENDING_FILE) } catch {}
    return
  }
  const chatId = data.chatId || getNotifyChatId()
  if (!chatId || !_bot) return
  await _bot.telegram.sendMessage(
    chatId,
    `✅ *KrakBot actualizado correctamente*\n\`${data.oldSha}\` → \`${data.newSha}\``,
    { parse_mode: 'Markdown' }
  ).catch(err => logger.warn(`updateChecker: could not send success msg — ${err.message}`))
}

// ─── Inline keyboard handlers ─────────────────────────────────────────────────

async function handleUpdateYes(ctx) {
  if (!_pendingNotification) {
    await ctx.editMessageText('Este update ya fue procesado o expiró.').catch(() => {})
    return
  }
  await performUpdate()
}

async function handleUpdateRemind(ctx) {
  if (!_pendingNotification) {
    await ctx.editMessageText('Este update ya fue procesado o expiró.').catch(() => {})
    return
  }
  _pendingNotification = null
  await ctx.editMessageText('⏰ Ok, te recuerdo en 1 hora.', { reply_markup: { inline_keyboard: [] } }).catch(() => {})

  setTimeout(async () => {
    const localSha = getLocalSha()
    if (!localSha) return
    const { repo, branch, token } = getConfig()
    try {
      const remote = await getRemoteCommit(repo, branch, token)
      if (remote.sha !== localSha && remote.sha !== _ignoredSha) {
        await sendUpdateNotification(localSha, remote.sha, remote.message)
      }
    } catch (err) {
      logger.warn(`updateChecker: remind re-check failed — ${err.message}`)
    }
  }, 60 * 60 * 1000)
}

async function handleUpdateIgnore(ctx) {
  if (!_pendingNotification) {
    await ctx.editMessageText('Este update ya fue procesado o expiró.').catch(() => {})
    return
  }
  _ignoredSha = _pendingNotification.sha
  _pendingNotification = null
  await ctx.editMessageText('🙈 Ok, ignorado hasta mañana.', { reply_markup: { inline_keyboard: [] } }).catch(() => {})
}

// ─── /update command handler ──────────────────────────────────────────────────

async function handleUpdate(ctx) {
  const { repo, branch, token } = getConfig()
  if (!repo) {
    await ctx.reply('⚠️ `GITHUB_REPO` no está configurado.', { parse_mode: 'Markdown' })
    return
  }
  if (_pendingNotification) {
    await ctx.reply('Ya hay una notificación de actualización pendiente. Respondé esa primero.')
    return
  }
  const localSha = getLocalSha()
  let remote
  try {
    remote = await getRemoteCommit(repo, branch, token)
  } catch (err) {
    await ctx.reply(`❌ No se pudo conectar con GitHub: \`${err.message.slice(0, 150)}\``, { parse_mode: 'Markdown' })
    return
  }
  if (remote.sha === localSha) {
    await ctx.reply(`✅ Ya estás en la última versión (\`${localSha.slice(0, 7)}\`)`, { parse_mode: 'Markdown' })
    return
  }
  await sendUpdateNotification(localSha, remote.sha, remote.message)
}

// ─── Public API ───────────────────────────────────────────────────────────────

function init(bot) {
  _bot = bot
}

function start() {
  const { intervalHours, repo } = getConfig()
  if (intervalHours <= 0 || !repo) {
    logger.info('updateChecker: disabled (UPDATE_CHECK_INTERVAL_HOURS=0 or GITHUB_REPO not set)')
    return
  }
  logger.info(`updateChecker: checking every ${intervalHours}h (repo: ${repo})`)
  setTimeout(() => check().catch(err => logger.error(`updateChecker check: ${err.message}`)), 30_000)
  setInterval(
    () => check().catch(err => logger.error(`updateChecker check: ${err.message}`)),
    intervalHours * 60 * 60 * 1000
  )
}

module.exports = {
  init,
  start,
  check,
  checkPendingUpdate,
  handleUpdate,
  handleUpdateYes,
  handleUpdateRemind,
  handleUpdateIgnore,
}
