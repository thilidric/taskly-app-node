// Reads Istanbul coverage (coverage-final.json) produced by @vitest/coverage-v8
// and reports per-file metrics, uncovered lines and coverage of specific lines.
import path from 'node:path'

const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 10000) / 100)

function compactRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b)
  const ranges = []
  for (const line of sorted) {
    const last = ranges.at(-1)
    if (last && line === last[1] + 1) last[1] = line
    else ranges.push([line, line])
  }
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
}

/** Maps coverage entries to repo-relative POSIX paths. */
export function indexByRepoPath(finalCoverage, repoRoot) {
  const result = {}
  for (const [file, data] of Object.entries(finalCoverage)) {
    const relative = path.relative(repoRoot, path.resolve(file)).split(path.sep).join('/')
    result[relative] = data
  }
  return result
}

/** Summarizes one file. changedLines restricts the "changed" metric to those lines. */
export function summarizeFile(data, changedLines = null) {
  const statements = Object.entries(data.statementMap)
  const coveredStatements = statements.filter(([id]) => data.s[id] > 0).length
  const uncovered = []
  for (const [id, loc] of statements) {
    if (data.s[id] === 0) for (let line = loc.start.line; line <= loc.end.line; line++) uncovered.push(line)
  }
  let branchTotal = 0
  let branchCovered = 0
  const uncoveredBranchLines = []
  for (const [id, branch] of Object.entries(data.branchMap)) {
    data.b[id].forEach((hits, index) => {
      branchTotal++
      if (hits > 0) branchCovered++
      else {
        // v8 reports implicit branches (e.g. a missing else) with an empty location.
        const line = branch.locations?.[index]?.start?.line ?? branch.loc?.start?.line ?? branch.line
        if (line) uncoveredBranchLines.push(line)
      }
    })
  }
  const functions = Object.keys(data.fnMap)
  const coveredFunctions = functions.filter((id) => data.f[id] > 0).length
  const summary = {
    statements: pct(coveredStatements, statements.length),
    branches: pct(branchCovered, branchTotal),
    functions: pct(coveredFunctions, functions.length),
    uncoveredLines: compactRanges(uncovered),
    uncoveredBranchLines: compactRanges(uncoveredBranchLines),
  }
  if (changedLines) {
    const wanted = new Set(changedLines)
    const relevant = statements.filter(([, loc]) => {
      for (let line = loc.start.line; line <= loc.end.line; line++) if (wanted.has(line)) return true
      return false
    })
    const covered = relevant.filter(([id]) => data.s[id] > 0).length
    summary.changedStatements = { covered, total: relevant.length, pct: pct(covered, relevant.length) }
  }
  return summary
}

/** Expands [[start, end], ...] into a list of line numbers. */
export function expandRanges(ranges = []) {
  const lines = []
  for (const [start, end] of ranges) for (let line = start; line <= end; line++) lines.push(line)
  return lines
}

/** Totals across all files in the coverage map. */
export function totals(indexed) {
  let statements = 0
  let covered = 0
  let branches = 0
  let branchesCovered = 0
  for (const data of Object.values(indexed)) {
    statements += Object.keys(data.s).length
    covered += Object.values(data.s).filter((hits) => hits > 0).length
    for (const hits of Object.values(data.b)) {
      branches += hits.length
      branchesCovered += hits.filter((value) => value > 0).length
    }
  }
  return { statements: pct(covered, statements), branches: pct(branchesCovered, branches) }
}
