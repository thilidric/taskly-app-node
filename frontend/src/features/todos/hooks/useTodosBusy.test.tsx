import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useTodosBusy } from './useTodosBusy'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

it('is busy only while a todo mutation is in flight', async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  let release: (value: typeof todoFixture) => void = () => {}
  vi.mocked(todosApi.create).mockReturnValue(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const { result } = renderHook(
    () => ({ busy: useTodosBusy(), create: useCreateTodoMutation() }),
    { wrapper },
  )
  expect(result.current.busy).toBe(false)
  let pending: Promise<unknown> = Promise.resolve()
  act(() => {
    pending = result.current.create.mutateAsync(todoFixture)
  })
  await waitFor(() => expect(result.current.busy).toBe(true))
  await act(async () => {
    release(todoFixture)
    await pending
  })
  await waitFor(() => expect(result.current.busy).toBe(false))
})
