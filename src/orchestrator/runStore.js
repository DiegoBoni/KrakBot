'use strict'

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const STATE_FILE = process.env.KRAKBOT_MISSION_CONTROL_STATE || path.join(process.cwd(), 'data', 'mission-control-state.json')
const TERMINAL = new Set(['done', 'failed', 'cancelled'])

function blankState() {
  return { version: 1, tasks: [], runs: [], events: [] }
}

function ensureStore() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, `${JSON.stringify(blankState(), null, 2)}\n`, 'utf8')
}

function load() {
  ensureStore()
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      version: state.version || 1,
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      runs: Array.isArray(state.runs) ? state.runs : [],
      events: Array.isArray(state.events) ? state.events : [],
    }
  } catch (err) {
    throw new Error(`No se pudo leer Mission Control state: ${err.message}`)
  }
}

function save(state) {
  ensureStore()
  const tmp = `${STATE_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, STATE_FILE)
}

function createRun(input) {
  const state = load()
  const now = new Date().toISOString()
  const run = {
    id: input.id || randomUUID(),
    project_id: input.project_id || null,
    issue_number: input.issue_number || null,
    agent: input.agent || null,
    branch: input.branch || null,
    status: input.status || 'queued',
    result: null,
    error: null,
    created_at: now,
    started_at: null,
    completed_at: null,
    updated_at: now,
  }
  state.runs.push(run)
  save(state)
  return run
}

function getRun(id) {
  return load().runs.find(run => run.id === id) || null
}

function listRuns({ projectId, status, limit = 100 } = {}) {
  let runs = load().runs
  if (projectId) runs = runs.filter(run => run.project_id === projectId)
  if (status) runs = runs.filter(run => run.status === status)
  return runs.slice(-Math.max(1, limit)).reverse()
}

function updateRun(id, patch) {
  const state = load()
  const index = state.runs.findIndex(run => run.id === id)
  if (index === -1) throw new Error(`Run no encontrado: ${id}`)
  const current = state.runs[index]
  const status = patch.status ?? current.status
  const now = new Date().toISOString()
  state.runs[index] = {
    ...current,
    ...patch,
    id: current.id,
    created_at: current.created_at,
    started_at: patch.started_at ?? (status === 'running' && !current.started_at ? now : current.started_at),
    completed_at: patch.completed_at ?? (TERMINAL.has(status) && !current.completed_at ? now : current.completed_at),
    updated_at: now,
  }
  save(state)
  return state.runs[index]
}

function addEvent(runId, type, payload = {}) {
  const state = load()
  if (!state.runs.some(run => run.id === runId)) throw new Error(`Run no encontrado: ${runId}`)
  const event = { id: randomUUID(), run_id: runId, type, payload, created_at: new Date().toISOString() }
  state.events.push(event)
  save(state)
  return event
}

function listEvents(runId) {
  return load().events.filter(event => event.run_id === runId)
}

function recoverInterruptedRuns() {
  const state = load()
  const now = new Date().toISOString()
  let changed = 0
  state.runs = state.runs.map(run => {
    if (!['running', 'testing'].includes(run.status)) return run
    changed++
    return {
      ...run,
      status: 'failed',
      error: run.error || 'KrakBot se reinició durante la ejecución',
      completed_at: now,
      updated_at: now,
    }
  })
  if (changed) save(state)
  return changed
}

module.exports = { createRun, getRun, listRuns, updateRun, addEvent, listEvents, recoverInterruptedRuns, STATE_FILE }
