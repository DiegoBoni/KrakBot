'use strict'

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { getAgentInfo } = require('../agents/router')

const PROJECTS_FILE = process.env.KRAKBOT_PROJECTS_FILE || path.join(process.cwd(), 'data', 'projects.json')

function ensureStore() {
  const dir = path.dirname(PROJECTS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]\n', 'utf8')
}

function readAll() {
  ensureStore()
  try {
    const parsed = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    throw new Error(`No se pudo leer el registro de proyectos: ${err.message}`)
  }
}

function writeAll(projects) {
  ensureStore()
  const tmp = `${PROJECTS_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, PROJECTS_FILE)
}

function normalizeLocalPath(value) {
  return path.resolve(String(value || '').trim())
}

function validateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) {
    throw new Error('repo debe tener formato owner/name')
  }
}

function validateLocalRepo(localPath) {
  if (!localPath || !fs.existsSync(localPath)) throw new Error(`local_path no existe: ${localPath}`)
  if (!fs.existsSync(path.join(localPath, '.git'))) throw new Error(`local_path no es un repositorio Git: ${localPath}`)
}

function validateAgent(agent) {
  if (!agent || !getAgentInfo(agent)) throw new Error(`Agente no soportado: ${agent || '(vacío)'}`)
}

function sanitize(input, existing = {}) {
  const project = {
    ...existing,
    name: String(input.name ?? existing.name ?? '').trim(),
    repo: String(input.repo ?? existing.repo ?? '').trim(),
    local_path: normalizeLocalPath(input.local_path ?? existing.local_path),
    default_branch: String(input.default_branch ?? existing.default_branch ?? 'DEV').trim() || 'DEV',
    default_agent: String(input.default_agent ?? existing.default_agent ?? 'claude').trim().toLowerCase(),
    enabled: input.enabled ?? existing.enabled ?? true,
  }

  if (!project.name) throw new Error('name es requerido')
  validateRepo(project.repo)
  validateLocalRepo(project.local_path)
  validateAgent(project.default_agent)
  project.enabled = Boolean(project.enabled)
  return project
}

function list({ enabledOnly = false } = {}) {
  const projects = readAll()
  return enabledOnly ? projects.filter(p => p.enabled) : projects
}

function get(id) {
  return readAll().find(p => p.id === id) || null
}

function create(input) {
  const projects = readAll()
  const project = sanitize(input)
  if (projects.some(p => p.repo.toLowerCase() === project.repo.toLowerCase())) {
    throw new Error(`Ya existe un proyecto para ${project.repo}`)
  }
  const now = new Date().toISOString()
  const saved = { id: randomUUID(), ...project, created_at: now, updated_at: now }
  projects.push(saved)
  writeAll(projects)
  return saved
}

function update(id, patch) {
  const projects = readAll()
  const index = projects.findIndex(p => p.id === id)
  if (index === -1) throw new Error(`Proyecto no encontrado: ${id}`)
  const next = sanitize(patch, projects[index])
  if (projects.some((p, i) => i !== index && p.repo.toLowerCase() === next.repo.toLowerCase())) {
    throw new Error(`Ya existe un proyecto para ${next.repo}`)
  }
  projects[index] = { ...projects[index], ...next, updated_at: new Date().toISOString() }
  writeAll(projects)
  return projects[index]
}

function remove(id) {
  const projects = readAll()
  const next = projects.filter(p => p.id !== id)
  if (next.length === projects.length) return false
  writeAll(next)
  return true
}

module.exports = { list, get, create, update, remove, PROJECTS_FILE }
