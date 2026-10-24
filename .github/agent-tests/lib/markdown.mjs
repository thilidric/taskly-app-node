// Escaping for model-written text rendered into a GitHub comment. The report
// is untrusted: it must not inject HTML, links, images, mentions or break tables.
export function text(value, max = 600) {
  let result = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (result.length > max) result = `${result.slice(0, max - 1)}…`
  return result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#!|~]/g, (char) => `\\${char}`)
    .replace(/@/g, '@​') // break @mentions and team pings
    .replace(/https?:\/\//gi, (scheme) => scheme.replace('://', ':​//')) // no autolinks
}

/** Inline code for paths; strips backticks so the span cannot be closed early. */
export function code(value, max = 200) {
  return `\`${String(value ?? '').replace(/[`\n\r]/g, '').slice(0, max)}\``
}

export function table(headers, rows) {
  if (!rows.length) return ''
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}
