import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    onCancel,
    initial,
    busy,
    error,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    onCancel: () => void
    initial?: { title: string }
    busy: boolean
    error: string | null
  }) => (
    <div>
      <p>initial={initial?.title ?? 'none'}</p>
      <p>busy={String(busy)}</p>
      <p>error={error ?? 'none'}</p>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      <button onClick={onCancel}>Cancel form</button>
    </div>
  ),
}))

const create = vi.fn()
const update = vi.fn()

function mockMutations({
  createState = {},
  updateState = {},
}: {
  createState?: Record<string, unknown>
  updateState?: Record<string, unknown>
} = {}) {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
    ...createState,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
    ...updateState,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue(todoFixture)
  update.mockResolvedValue(todoFixture)
})

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  mockMutations()
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  expect(screen.getByText('initial=none')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('updates an existing task and reports saved changes', async () => {
  const user = userEvent.setup()
  mockMutations()
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(screen.getByText(`initial=${todoFixture.title}`)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: todoFixture,
  })
  expect(create).not.toHaveBeenCalled()
})

it('does not report a save when the mutation fails', async () => {
  const user = userEvent.setup()
  create.mockRejectedValue(new Error('fail'))
  mockMutations()
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
})

it('passes the active mutation error to the form', () => {
  mockMutations({
    createState: { error: new Error('create failed') },
    updateState: { error: new Error('update failed') },
  })
  const { rerender } = render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('error=create failed')).toBeVisible()
  rerender(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByText('error=update failed')).toBeVisible()
})

it.each([
  ['the page is busy', true, {}],
  ['the mutation is pending', false, { isPending: true }],
])('ignores submissions while %s', async (_, busy, createState) => {
  const user = userEvent.setup()
  mockMutations({ createState })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={busy} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByText('busy=true')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('closes when the form is cancelled', async () => {
  const user = userEvent.setup()
  mockMutations()
  const onClose = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Cancel form' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
