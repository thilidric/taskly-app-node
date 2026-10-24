import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

const respond = (status: number, body?: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('prefixes the path with /api and sends JSON headers merged with custom ones', async () => {
  const fetchMock = respond(200, [{ id: 1 }])
  await expect(
    request('/todos', { headers: { 'X-Test': '1' }, method: 'POST' }),
  ).resolves.toEqual([{ id: 1 }])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
  })
})

it('returns undefined for 204 responses', async () => {
  respond(204)
  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('uses the server detail message for failed requests', async () => {
  respond(404, { detail: 'Task not found.' })
  await expect(request('/todos/1')).rejects.toThrow('Task not found.')
})

it('falls back to a generic message when the error body has no string detail', async () => {
  respond(500, { detail: 42 })
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('falls back to a generic message when the error body is not JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })),
  )
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('explains validation limits for 422 responses', async () => {
  respond(422, { detail: [{ msg: 'bad' }] })
  await expect(request('/todos')).rejects.toThrow(/Check the task details/)
})

it('reports a connection problem when fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed')))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException('Aborted', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})
