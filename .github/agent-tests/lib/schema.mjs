// Minimal JSON Schema validator for the subset used by report.schema.json
// (type, const, enum, required, properties, additionalProperties: false, items,
// minLength, maxLength, maxItems, minimum, maximum). Avoids a dependency in CI.
const typeOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value)

export function validate(schema, value, at = '$') {
  const errors = []
  const actual = typeOf(value)
  if (schema.type && !(schema.type === actual || (schema.type === 'number' && actual === 'integer'))) {
    return [`${at}: expected ${schema.type}, got ${actual}`]
  }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`)
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${at}[${index}]`)))
  }
  if (actual === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing ${key}`)
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], item, `${at}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`)
    }
  }
  return errors
}
