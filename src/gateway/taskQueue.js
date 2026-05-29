'use strict'

const { randomBytes }      = require('crypto')
const { dispatchStreaming } = require('../agents/router')
const sessionManager       = require('../utils/sessionManager')
const logger               = require('../utils/logger')

const _tasks  = new Map()
const _queue  = []
let   _active = 0

const maxConcurrent = () => Math.max(1, parseInt(process.env.HTTP_MAX_CONCURRENT) || 3)
const taskTtlMs     = () => (parseFloat(process.env.HTTP_TASK_TTL_HOURS) || 2) * 3_600_000

function _shortId() {
  return randomBytes(4).toString('hex').toUpperCase()
}

function _serialize(task) {
  // eslint-disable-next-line no-unused-vars
  const { _sseListeners, _abortController, ...pub } = task
  return pub
}

function _isSessionBusy(sessionId) {
  for (const task of _tasks.values()) {
    if (task.session_id === sessionId && task.status === 'running') return true
  }
  return false
}

function _broadcast(task, data) {
  for (const listener of task._sseListeners) {
    try { listener(data) } catch {}
  }
}

async function _run(task) {
  task.status     = 'running'
  task.started_at = new Date().toISOString()
  _active++

  const ac = new AbortController()
  task._abortController = ac

  const session = sessionManager.getOrCreate(task.session_id)

  // Codex doesn't produce useful incremental stdout — use non-streaming dispatch
  const isCodex = task.agent === 'codex' || task.agent.startsWith('custom:codex')
  let output = ''

  try {
    if (isCodex) {
      const { dispatch } = require('../agents/router')
      output = await dispatch(task.agent, task.prompt, session, ac.signal)
    } else {
      output = await dispatchStreaming(
        task.agent, task.prompt, session, ac.signal,
        (chunk) => {
          output += chunk
          task.output = output
          _broadcast(task, { type: 'chunk', text: chunk })
        }
      )
    }

    task.output       = output
    task.status       = 'done'
    task.completed_at = new Date().toISOString()
    sessionManager.addToHistory(task.session_id, 'user',      task.prompt, task.agent)
    sessionManager.addToHistory(task.session_id, 'assistant', output,      task.agent)
    _broadcast(task, { type: 'done', output })
  } catch (err) {
    if (!err.cancelled) {
      task.error        = err.message
      task.status       = 'failed'
      task.completed_at = new Date().toISOString()
      _broadcast(task, { type: 'error', message: err.message })
      logger.error(`HTTP task ${task.id} failed: ${err.message}`)
    }
  } finally {
    task._abortController = null
    _active--
    _tryNext()
  }
}

function _tryNext() {
  for (let i = 0; i < _queue.length && _active < maxConcurrent(); i++) {
    const id   = _queue[i]
    const task = _tasks.get(id)
    if (!task || task.status !== 'pending') { _queue.splice(i--, 1); continue }
    if (_isSessionBusy(task.session_id)) continue
    _queue.splice(i--, 1)
    _run(task).catch(() => {})
  }
}

function create(sessionId, agentKey, prompt) {
  const task = {
    id:               _shortId(),
    session_id:       sessionId,
    agent:            agentKey,
    prompt,
    status:           'pending',
    output:           null,
    error:            null,
    logs:             [],
    created_at:       new Date().toISOString(),
    started_at:       null,
    completed_at:     null,
    _sseListeners:    new Set(),
    _abortController: null,
  }
  _tasks.set(task.id, task)
  _queue.push(task.id)
  _tryNext()
  return task
}

function get(taskId) {
  const task = _tasks.get(taskId)
  return task ? _serialize(task) : null
}

function getRaw(taskId) {
  return _tasks.get(taskId) ?? null
}

function cancel(taskId) {
  const task = _tasks.get(taskId)
  if (!task) return false
  if (task._abortController) task._abortController.abort()
  task.status       = 'cancelled'
  task.completed_at = new Date().toISOString()
  _broadcast(task, { type: 'error', message: 'Task cancelled' })
  return true
}

function startCleanup() {
  setInterval(() => {
    const cutoff = Date.now() - taskTtlMs()
    for (const [id, task] of _tasks) {
      if (['done', 'failed', 'cancelled'].includes(task.status)) {
        const ts = task.completed_at ? new Date(task.completed_at).getTime() : 0
        if (ts < cutoff) _tasks.delete(id)
      }
    }
  }, 60_000)
}

module.exports = { create, get, getRaw, cancel, startCleanup }
