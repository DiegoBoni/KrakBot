'use strict'

const https = require('https')

const API_HOST = 'api.github.com'
const MAX_PAGES = 5

function headers() {
  const result = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'KrakBot-Mission-Control',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return result
}

function requestJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: API_HOST, path, method: 'GET', headers: headers() }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = body ? JSON.parse(body) : null } catch { return reject(new Error(`GitHub devolvió JSON inválido (${res.statusCode})`)) }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(parsed?.message || `GitHub API respondió ${res.statusCode}`)
          err.status = res.statusCode
          err.response = parsed
          return reject(err)
        }
        resolve({ data: parsed, link: res.headers.link || '' })
      })
    })
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API timeout')))
    req.on('error', reject)
    req.end()
  })
}

function parseNext(link) {
  if (!link) return null
  const entry = link.split(',').find(part => /rel="next"/.test(part))
  const match = entry && entry.match(/<https:\/\/api\.github\.com([^>]+)>/)
  return match ? match[1] : null
}

async function paged(path) {
  const all = []
  let next = path
  let page = 0
  while (next && page++ < MAX_PAGES) {
    const response = await requestJson(next)
    if (Array.isArray(response.data)) all.push(...response.data)
    next = parseNext(response.link)
  }
  return all
}

function parseRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('repo debe tener formato owner/name')
  const [owner, name] = repo.split('/')
  return { owner, name }
}

function issueView(issue) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    state: issue.state,
    labels: (issue.labels || []).map(label => typeof label === 'string' ? label : label.name),
    assignees: (issue.assignees || []).map(user => user.login),
    author: issue.user?.login || null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
  }
}

function prView(pr) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || '',
    state: pr.state,
    draft: Boolean(pr.draft),
    head: pr.head?.ref || null,
    base: pr.base?.ref || null,
    author: pr.user?.login || null,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    url: pr.html_url,
  }
}

async function listOpenIssues(repo) {
  const { owner, name } = parseRepo(repo)
  const items = await paged(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=open&per_page=100`)
  return items.filter(item => !item.pull_request).map(issueView)
}

async function listOpenPullRequests(repo) {
  const { owner, name } = parseRepo(repo)
  const items = await paged(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=open&per_page=100`)
  return items.map(prView)
}

function referencesIssue(pr, issueNumber) {
  const text = `${pr.title || ''}\n${pr.body || ''}`
  return new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)?\\s*#${issueNumber}\\b`, 'i').test(text)
}

async function getProjectSnapshot(repo) {
  const [issues, pull_requests] = await Promise.all([
    listOpenIssues(repo),
    listOpenPullRequests(repo),
  ])
  const issuesWithPrs = issues.map(issue => ({
    ...issue,
    related_prs: pull_requests.filter(pr => referencesIssue(pr, issue.number)).map(pr => pr.number),
  }))
  return { repo, issues: issuesWithPrs, pull_requests, fetched_at: new Date().toISOString() }
}

module.exports = { listOpenIssues, listOpenPullRequests, getProjectSnapshot, referencesIssue }
