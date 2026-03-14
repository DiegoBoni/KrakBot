'use strict'

const CATALOG = [
  {
    name: 'github',
    label: '🐙 GitHub',
    description: 'Acceso a repositorios, issues, PRs y código fuente',
    domains: ['development', 'operations', 'security'],
    keywords: ['code', 'repo', 'developer', 'devops', 'reviewer', 'git', 'github', 'pull request', 'issue', 'desarrollo', 'código', 'programación', 'software'],
  },
  {
    name: 'filesystem',
    label: '📁 Filesystem',
    description: 'Lectura y escritura de archivos locales',
    domains: ['development', 'operations', 'security'],
    keywords: ['file', 'code', 'developer', 'devops', 'build', 'deploy', 'script', 'archivo', 'desarrollo', 'programación'],
  },
  {
    name: 'browser',
    label: '🌐 Browser',
    description: 'Navegación web y scraping',
    domains: ['marketing', 'research', 'support', 'content_seo', 'ecommerce'],
    keywords: ['web', 'search', 'browse', 'research', 'investigación', 'marketing', 'seo', 'contenido', 'scraping', 'internet'],
  },
  {
    name: 'notion',
    label: '📝 Notion',
    description: 'Acceso a workspace de Notion',
    domains: ['marketing', 'productivity', 'operations', 'content_seo'],
    keywords: ['notion', 'doc', 'wiki', 'knowledge', 'documentación', 'contenido', 'base de conocimiento'],
  },
  {
    name: 'slack',
    label: '💬 Slack',
    description: 'Mensajería en Slack',
    domains: ['operations', 'support', 'marketing', 'productivity'],
    keywords: ['slack', 'message', 'notify', 'comunicación', 'notificación', 'mensajes', 'canal'],
  },
  {
    name: 'jira',
    label: '🎫 Jira',
    description: 'Gestión de issues y sprints en Jira',
    domains: ['development', 'operations', 'productivity'],
    keywords: ['jira', 'issue', 'ticket', 'sprint', 'project', 'task', 'tarea', 'gestión', 'backlog'],
  },
  {
    name: 'postgres',
    label: '🐘 PostgreSQL',
    description: 'Consultas a base de datos PostgreSQL',
    domains: ['development', 'data', 'finance'],
    keywords: ['database', 'sql', 'postgres', 'data', 'query', 'base de datos', 'datos', 'tabla', 'registro'],
  },
  {
    name: 'linear',
    label: '📐 Linear',
    description: 'Gestión de tareas y bugs en Linear',
    domains: ['development'],
    keywords: ['linear', 'issue', 'bug', 'roadmap', 'sprint', 'task', 'tarea', 'feature'],
  },
]

/**
 * Suggest MCPs based on domain and free-text hints.
 * @param {string} domain  - One of the domain IDs (e.g. 'development')
 * @param {string} hints   - Free text from agent names/descriptions
 * @returns {{ suggested: string[], optional: string[] }}
 */
function suggest(domain, hints = '') {
  const lower = hints.toLowerCase()
  const suggested = []
  const optional  = []

  for (const mcp of CATALOG) {
    const inDomain  = domain && mcp.domains.includes(domain)
    const kwMatches = mcp.keywords.filter(kw => lower.includes(kw)).length

    if (inDomain || kwMatches >= 2) {
      suggested.push(mcp.name)
    } else if (kwMatches >= 1) {
      optional.push(mcp.name)
    }
  }

  return { suggested, optional }
}

function getAll() {
  return CATALOG
}

function getByName(name) {
  return CATALOG.find(m => m.name === name) ?? null
}

module.exports = { suggest, getAll, getByName }
