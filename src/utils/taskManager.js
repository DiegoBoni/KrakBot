'use strict'

const fs   = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const logger = require('./logger')

const DATA_FILE = path.resolve(__dirname, '../../data/team-tasks.json')

// Valid status transitions: from → Set of allowed destinations
const TRANSITIONS = {
  pending:              new Set(['assigned', 'failed']),
  assigned:             new Set(['in_progress', 'failed']),
  in_progress:          new Set(['in_review', 'failed']),
  in_review:            new Set(['done', 'awaiting_user_review', 'changes_requested', 'failed']),
  awaiting_user_review: new Set(['done', 'changes_requested', 'failed']),
  changes_requested:    new Set(['in_progress', 'failed']),
  done:                 new Set(),
  failed:               new Set(),
  interrupted:          new Set(),
}

// Statuses considered "active" (not terminal)
const ACTIVE_STATUSES = new Set([
  'pending', 'assigned', 'in_progress', 'in_review', 'awaiting_user_review', 'changes_requested',
])

let _tasks = []

// ─── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
      fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, tasks: [] }, null, 2))
      logger.info('taskManager: created data/team-tasks.json')
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    _tasks = Array.isArray(data.tasks) ? data.tasks : []
    logger.info(`taskManager: loaded ${_tasks.length} task(s)`)
  } catch (err) {
    logger.error(`taskManager: init failed — ${err.message}`)
    _tasks = []
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────────

function _save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, tasks: _tasks }, null, 2), 'utf8')
}

// ─── Short ID ──────────────────────────────────────────────────────────────────

function _shortId() {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function create(teamId, description, userId, chatId, priority = 'normal') {
  const task = {
    id:                   _shortId(),
    teamId,
    title:                description.slice(0, 80),
    description,
    status:               'pending',
    priority,
    createdBy:            String(userId),
    notifyChatId:         chatId,
    coordinatorDecision:  null,
    assignedTo:           null,
    reviewedBy:           null,
    reviewDecision:       null,
    reviewComment:        null,
    output:               null,
    iterations:           0,
    scheduledAt:          null,
    startedAt:            null,
    completedAt:          null,
    createdAt:            new Date().toISOString(),
    history:              [{ timestamp: new Date().toISOString(), event: 'created', by: String(userId), note: '' }],
  }
  _tasks.push(task)
  _save()
  return task
}

function get(taskId) {
  return _tasks.find(t => t.id === taskId) ?? null
}

function listByTeam(teamId) {
  return _tasks.filter(t => t.teamId === teamId)
}

function listActive() {
  return _tasks.filter(t => ACTIVE_STATUSES.has(t.status))
}

function listCompletedToday(teamId) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  return _tasks.filter(t =>
    (!teamId || t.teamId === teamId) &&
    t.status === 'done' &&
    t.completedAt &&
    new Date(t.completedAt) >= startOfDay
  )
}

// ─── State machine ─────────────────────────────────────────────────────────────

function transition(taskId, newStatus, meta = {}) {
  const idx = _tasks.findIndex(t => t.id === taskId)
  if (idx === -1) throw new Error(`Task ${taskId} not found`)

  const task = _tasks[idx]
  const allowed = TRANSITIONS[task.status]

  // Allow forced transition to 'interrupted' from any active status
  if (newStatus === 'interrupted' && ACTIVE_STATUSES.has(task.status)) {
    // ok
  } else if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${task.status} → ${newStatus}`)
  }

  const now = new Date().toISOString()
  task.status = newStatus

  if (newStatus === 'in_progress' && !task.startedAt) task.startedAt = now
  if (newStatus === 'done' || newStatus === 'failed') task.completedAt = now

  task.history.push({
    timestamp: now,
    event: newStatus,
    by: meta.by ?? 'system',
    note: meta.note ?? '',
  })

  _save()
  return task
}

// ─── Field setters ─────────────────────────────────────────────────────────────

function setCoordinatorDecision(taskId, assignTo, instruction) {
  const idx = _tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return
  _tasks[idx].coordinatorDecision = instruction
  _tasks[idx].assignedTo = assignTo
  _tasks[idx].history.push({
    timestamp: new Date().toISOString(),
    event: 'assigned',
    by: 'coordinator',
    note: `→ ${assignTo}`,
  })
  _save()
}

function setWorkerOutput(taskId, output) {
  const idx = _tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return
  _tasks[idx].output = output
  _tasks[idx].history.push({
    timestamp: new Date().toISOString(),
    event: 'output_ready',
    by: _tasks[idx].assignedTo ?? 'worker',
    note: '',
  })
  _save()
}

function setReviewDecision(taskId, decision, comment, reviewedBy) {
  const idx = _tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return
  _tasks[idx].reviewDecision = decision
  _tasks[idx].reviewComment  = comment ?? null
  _tasks[idx].reviewedBy     = reviewedBy ?? null
  _tasks[idx].history.push({
    timestamp: new Date().toISOString(),
    event: decision === 'approved' ? 'approved' : 'changes_requested',
    by: reviewedBy ?? 'reviewer',
    note: comment ?? '',
  })
  _save()
}

function incrementIterations(taskId) {
  const idx = _tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return
  _tasks[idx].iterations++
  _save()
}

function cancel(taskId, by = 'user') {
  const task = get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!ACTIVE_STATUSES.has(task.status)) throw new Error(`Task ${taskId} ya está en estado terminal`)
  return transition(taskId, 'failed', { by, note: 'cancelled' })
}

/**
 * At bot restart: mark all in-flight tasks as interrupted.
 * Returns list of interrupted tasks (so callers can notify users).
 */
function markInterrupted() {
  const interrupted = []
  for (const task of _tasks) {
    if (ACTIVE_STATUSES.has(task.status)) {
      task.status = 'interrupted'
      task.completedAt = new Date().toISOString()
      task.history.push({
        timestamp: new Date().toISOString(),
        event: 'interrupted',
        by: 'system',
        note: 'Bot reiniciado',
      })
      interrupted.push(task)
    }
  }
  if (interrupted.length > 0) {
    _save()
    logger.warn(`taskManager: marked ${interrupted.length} task(s) as interrupted on restart`)
  }
  return interrupted
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function elapsedMinutes(task) {
  if (!task.startedAt) return 0
  return Math.round((Date.now() - new Date(task.startedAt).getTime()) / 60000)
}

const STATUS_EMOJI = {
  pending:              '⏳',
  assigned:             '📋',
  in_progress:          '🟡',
  in_review:            '🔵',
  awaiting_user_review: '👤',
  changes_requested:    '🔄',
  done:                 '✅',
  failed:               '❌',
  interrupted:          '⚠️',
}

function statusEmoji(status) {
  return STATUS_EMOJI[status] ?? '❓'
}

module.exports = {
  init,
  create,
  get,
  listByTeam,
  listActive,
  listCompletedToday,
  transition,
  setCoordinatorDecision,
  setWorkerOutput,
  setReviewDecision,
  incrementIterations,
  cancel,
  markInterrupted,
  elapsedMinutes,
  statusEmoji,
}
