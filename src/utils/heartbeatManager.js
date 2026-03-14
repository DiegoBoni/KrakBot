'use strict'

const logger      = require('./logger')
const taskManager = require('./taskManager')
const teamManager = require('./teamManager')

// taskId → { intervalId, chatId, teamId, telegram }
const _intervals = new Map()

// ─── Format ────────────────────────────────────────────────────────────────────

function _pad(n) { return String(n).padStart(2, '0') }

function _timeNow() {
  const d = new Date()
  return `${_pad(d.getHours())}:${_pad(d.getMinutes())}`
}

function buildStatusMessage(task, team) {
  const elapsed   = taskManager.elapsedMinutes(task)
  const statusEmoji = taskManager.statusEmoji(task.status)
  const worker    = task.assignedTo ? task.assignedTo : '—'

  let active  = 0
  let doneToday = 0
  try {
    active    = taskManager.listActive().filter(t => t.teamId === team.id).length
    doneToday = taskManager.listCompletedToday(team.id).length
  } catch { /* ignore */ }

  return (
    `⏳ *Estado del equipo ${team.name}* — ${_timeNow()}\n\n` +
    `${statusEmoji} *#${task.id}* _${task.title}_\n` +
    `   └─ 👷 ${worker} — ${task.status}${elapsed > 0 ? ` (${elapsed} min)` : ''}\n\n` +
    `📊 Activas: ${active} · Completadas hoy: ${doneToday}`
  )
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

function start(taskId, chatId, teamId, intervalMin, telegram) {
  if (!intervalMin || intervalMin <= 0) return  // disabled
  if (_intervals.has(taskId)) return            // already running

  const ms = intervalMin * 60 * 1000

  const intervalId = setInterval(async () => {
    const task = taskManager.get(taskId)
    if (!task) { stop(taskId); return }

    // Stop heartbeat when task reaches a terminal state
    const TERMINAL = new Set(['done', 'failed', 'interrupted'])
    if (TERMINAL.has(task.status)) { stop(taskId); return }

    const team = teamManager.get(teamId)
    if (!team) { stop(taskId); return }

    try {
      await telegram.sendMessage(chatId, buildStatusMessage(task, team), { parse_mode: 'Markdown' })
    } catch (err) {
      logger.warn(`heartbeatManager: sendMessage failed for task ${taskId}: ${err.message}`)
    }
  }, ms)

  _intervals.set(taskId, { intervalId, chatId, teamId, telegram })
  logger.info(`heartbeatManager: started heartbeat for task ${taskId} every ${intervalMin} min`)
}

function stop(taskId) {
  const entry = _intervals.get(taskId)
  if (!entry) return
  clearInterval(entry.intervalId)
  _intervals.delete(taskId)
}

function stopAll() {
  for (const [taskId, entry] of _intervals) {
    clearInterval(entry.intervalId)
    logger.info(`heartbeatManager: stopped heartbeat for task ${taskId}`)
  }
  _intervals.clear()
}

/**
 * Called at bot restart: re-starts heartbeats for all active tasks that have a team
 * with heartbeatIntervalMin > 0.
 */
function restoreActive(telegram) {
  const active = taskManager.listActive()
  let restored = 0
  for (const task of active) {
    const team = teamManager.get(task.teamId)
    if (!team || !team.heartbeatIntervalMin) continue
    if (_intervals.has(task.id)) continue  // already running
    start(task.id, task.notifyChatId, task.teamId, team.heartbeatIntervalMin, telegram)
    restored++
  }
  if (restored > 0) logger.info(`heartbeatManager: restored ${restored} heartbeat(s) on restart`)
}

module.exports = { start, stop, stopAll, restoreActive, buildStatusMessage }
