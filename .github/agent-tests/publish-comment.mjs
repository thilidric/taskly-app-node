#!/usr/bin/env node
// Creates or updates the single sticky agent comment on a pull request.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node .github/agent-tests/publish-comment.mjs --pr <number> --body <file>
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER } from './render-comment.mjs'

const MAX_BODY = 65000 // GitHub rejects comments over 65536 characters.

export async function upsertComment({ repository, pr, body, token, updateOnly = false, api = 'https://api.github.com', fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const call = async (url, init = {}) => {
    const response = await fetchImpl(url, { ...init, headers: { ...headers, ...init.headers } })
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${response.status} ${await response.text()}`)
    return response.json()
  }
  const content = body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n\n_…truncated; see the workflow summary._` : body
  let existing = null
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = await call(`${api}/repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`)
    existing = comments.find((comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(MARKER)) ?? null
    if (comments.length < 100) break
  }
  if (!existing && updateOnly) return { action: 'skipped', url: null }
  const init = { method: existing ? 'PATCH' : 'POST', body: JSON.stringify({ body: content }), headers: { 'Content-Type': 'application/json' } }
  const url = existing ? `${api}/repos/${repository}/issues/comments/${existing.id}` : `${api}/repos/${repository}/issues/${pr}/comments`
  const result = await call(url, init)
  return { action: existing ? 'updated' : 'created', url: result.html_url }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => (index % 2 ? pairs : [...pairs, [arg.slice(2), all[index + 1]]]), []))
  if (!/^\d+$/.test(args.pr ?? '')) throw new Error('--pr must be a number')
  const result = await upsertComment({
    repository: process.env.GITHUB_REPOSITORY,
    pr: args.pr,
    body: readFileSync(args.body, 'utf8'),
    token: process.env.GITHUB_TOKEN,
    updateOnly: args['update-only'] === 'true',
    api: process.env.GITHUB_API_URL,
  })
  console.log(result.url ? `comment ${result.action}: ${result.url}` : 'no existing comment to update; skipped')
}
