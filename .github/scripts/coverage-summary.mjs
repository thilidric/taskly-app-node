#!/usr/bin/env node
// Renders a project's coverage-summary.json (Vitest json-summary reporter) as a
// Markdown table for the GitHub job summary.
//   node .github/scripts/coverage-summary.mjs <project name> <coverage-summary.json>
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const METRICS = ['statements', 'branches', 'functions', 'lines']
const icon = (pct) => (pct >= 90 ? '🟢' : pct >= 70 ? '🟡' : '🔴')
const cell = (metric) => `${icon(metric.pct)} ${metric.pct}% (${metric.covered}/${metric.total})`

export function renderSummary(name, summary, root) {
  const { total, ...files } = summary
  const rows = Object.entries(files)
    .map(([file, metrics]) => [path.relative(root, file).split(path.sep).join('/'), metrics])
    .sort(([a], [b]) => a.localeCompare(b))
  return [
    `### ${name} coverage`,
    '',
    `| ${METRICS.map((metric) => metric[0].toUpperCase() + metric.slice(1)).join(' | ')} |`,
    `| ${METRICS.map(() => '---').join(' | ')} |`,
    `| ${METRICS.map((metric) => cell(total[metric])).join(' | ')} |`,
    '',
    `<details><summary>Per file (${rows.length})</summary>`,
    '',
    `| File | ${METRICS.join(' | ')} |`,
    `| --- | ${METRICS.map(() => '---').join(' | ')} |`,
    ...rows.map(([file, metrics]) => `| \`${file}\` | ${METRICS.map((metric) => `${metrics[metric].pct}%`).join(' | ')} |`),
    '',
    '</details>',
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, file] = process.argv.slice(2)
  const summary = JSON.parse(readFileSync(file, 'utf8'))
  console.log(renderSummary(name, summary, path.resolve(path.dirname(file), '..')))
}
