'use strict'

const fs   = require('fs')
const path = require('path')
const logger = require('./logger')
const customAgentManager = require('./customAgentManager')

const DATA_FILE = path.resolve(__dirname, '../../data/teams.json')
const MAX_TEAMS    = 10
const MAX_WORKERS  = 5
const VALID_REVIEW_MODES = new Set(['auto', 'manual', 'none'])

let _teams = []

// ─── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
      fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, teams: [] }, null, 2))
      logger.info('teamManager: created data/teams.json')
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    _teams = Array.isArray(data.teams) ? data.teams : []
    logger.info(`teamManager: loaded ${_teams.length} team(s)`)
  } catch (err) {
    logger.error(`teamManager: init failed — ${err.message}`)
    _teams = []
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────────

function _save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, teams: _teams }, null, 2), 'utf8')
}

// ─── ID helpers ────────────────────────────────────────────────────────────────

function generateId(name) {
  return name
    .replace(/^\p{Emoji_Presentation}\s*/u, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Verifica que coordinator y workers existan como custom agents.
 * Retorna lista de IDs faltantes (vacía si todos existen).
 */
function validateMembers(def) {
  const missing = []
  if (def.coordinator && !customAgentManager.exists(def.coordinator)) {
    missing.push(def.coordinator)
  }
  for (const w of (def.workers ?? [])) {
    if (!customAgentManager.exists(w)) missing.push(w)
  }
  if (def.reviewer && !customAgentManager.exists(def.reviewer)) {
    missing.push(def.reviewer)
  }
  return missing
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function list() {
  return [..._teams]
}

function get(id) {
  return _teams.find(t => t.id === id) ?? null
}

function exists(id) {
  return _teams.some(t => t.id === id)
}

function create(def) {
  const id = def.id ?? generateId(def.name ?? '')
  if (!id) throw new Error('Nombre inválido — no se pudo generar un ID para el team')

  if (!def.coordinator) throw new Error('El team necesita un coordinator')
  if (!def.workers || def.workers.length === 0) throw new Error('El team necesita al menos 1 worker')
  if (def.workers.length > MAX_WORKERS) throw new Error(`Máximo ${MAX_WORKERS} workers por team`)
  if (_teams.length >= MAX_TEAMS && !exists(id)) throw new Error(`Límite de ${MAX_TEAMS} teams alcanzado`)

  if (def.reviewMode && !VALID_REVIEW_MODES.has(def.reviewMode)) {
    throw new Error(`reviewMode inválido. Valores válidos: auto, manual, none`)
  }

  const team = {
    id,
    name:                  def.name,
    domain:                def.domain ?? 'custom',
    description:           def.description ?? '',
    coordinator:           def.coordinator,
    workers:               [...def.workers],
    reviewer:              def.reviewer ?? null,
    reviewMode:            def.reviewMode ?? 'auto',
    maxReviewIterations:   Number.isInteger(def.maxReviewIterations) ? def.maxReviewIterations : 3,
    heartbeatIntervalMin:  Number.isInteger(def.heartbeatIntervalMin) ? def.heartbeatIntervalMin : 5,
    createdAt:             new Date().toISOString(),
  }

  const idx = _teams.findIndex(t => t.id === id)
  if (idx !== -1) {
    _teams[idx] = team
  } else {
    _teams.push(team)
  }
  _save()
  return team
}

function update(id, fields) {
  const idx = _teams.findIndex(t => t.id === id)
  if (idx === -1) return null
  _teams[idx] = { ..._teams[idx], ...fields }
  _save()
  return _teams[idx]
}

/**
 * Elimina un team. Lanza error si hay tareas activas.
 * taskManager se pasa por parámetro para evitar dependencia circular.
 */
function remove(id, taskManager) {
  if (!exists(id)) return false
  if (taskManager) {
    const active = taskManager.listActive().filter(t => t.teamId === id)
    if (active.length > 0) {
      throw new Error(`No se puede eliminar el team — hay ${active.length} tarea(s) activa(s)`)
    }
  }
  _teams = _teams.filter(t => t.id !== id)
  _save()
  return true
}

module.exports = {
  init,
  list,
  get,
  exists,
  create,
  update,
  remove,
  generateId,
  validateMembers,
}
