# Frontend test patterns

Copy the closest pattern and adapt it. Paths are shown for a test at
`src/features/todos/<dir>/X.test.tsx`. Adjust the `../` depth.

## Presentational component with callbacks

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('forwards toggle and delete for a completed task', async () => {
  const user = userEvent.setup()
  const props = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }
  const todo = { ...todoFixture, completed: true }
  render(<TodoItem todo={todo} busy={false} {...props} />)
  await user.click(screen.getByRole('checkbox', { name: `Mark as active: ${todo.title}` }))
  await user.click(screen.getByRole('button', { name: `Delete: ${todo.title}` }))
  expect(props.onToggle).toHaveBeenCalledTimes(1)
  expect(props.onDelete).toHaveBeenCalledTimes(1)
})
```

## Container component with mocked hooks and children

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useDeleteTodoMutation } from '../hooks/useDeleteTodoMutation'
import { DeleteTodoDialog } from './DeleteTodoDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))

function mockMutation(overrides: Partial<{ isPending: boolean; error: Error | null; mutateAsync: () => Promise<unknown> }> = {}) {
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
}

it('deletes the task and reports success', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  mockMutation({ mutateAsync })
  const onDeleted = vi.fn()
  render(<DeleteTodoDialog todo={todoFixture} busy={false} onClose={vi.fn()} onDeleted={onDeleted} />)
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
})
```

To capture props a mocked child received, mock it with a `vi.fn` component and
read `vi.mocked(Child).mock.calls.at(-1)![0]`. To drive a child callback,
render a button in the mock that calls the prop, as `TodoEditor.test.tsx` does
with `TodoForm`.

## TanStack Query hook (real QueryClient, mocked API)

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

it('prepends the created task to the cached list', async () => {
  const { client, wrapper } = setup()
  const older = { ...todoFixture, id: 1 }
  client.setQueryData(todoKeys.list, [older])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, older])
})
```

For queries, `renderHook(() => useTodosQuery(), { wrapper })` then
`await waitFor(() => expect(result.current.isSuccess).toBe(true))`. To test
`useTodosBusy`, start a mutation whose promise you control
(`new Promise((resolve) => { release = resolve })`) and assert before and
after resolving.

## Fetch wrapper (`lib/http`)

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  ))

it('uses the server detail message for failed requests', async () => {
  respond(404, { detail: 'Task not found.' })
  await expect(request('/todos/1')).rejects.toThrow('Task not found.')
})
```

`new Response(null, { status: 204 })` works for the 204 path. For network
errors use `vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))`. For
aborts pass `{ signal: controller.signal }` after `controller.abort()`.

## Pure utilities with dates

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12)) // local time: 15 Oct 2026
})
afterEach(() => vi.useRealTimers())
```

## Timers in hooks (`useNotice`)

```ts
vi.useFakeTimers()
const { result } = renderHook(() => useNotice())
act(() => result.current.notify('Saved.'))
expect(result.current.message).toBe('Saved.')
act(() => vi.advanceTimersByTime(4000))
expect(result.current.message).toBe('')
vi.useRealTimers()
```

## Providers (`AppProviders`)

Render a probe child that reads context (`useQueryClient()`, `useTheme()` from
styled-components) and assert that the passed `client` and the design-system
`theme` reach it. Don't mock the design system for this one; it needs the real
`GlobalStyles` and `theme`.
