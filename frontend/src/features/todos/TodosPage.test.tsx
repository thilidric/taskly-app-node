import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import type { Todo } from './types'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    disabled,
    onCreate,
  }: {
    disabled: boolean
    onCreate: () => void
  }) => (
    <button disabled={disabled} onClick={onCreate}>
      New task
    </button>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: (props: {
    loading: boolean
    failed: boolean
    hasTodos: boolean
    onToggle: (todo: Todo) => void
    onEdit: (todo: Todo) => void
    onDelete: (todo: Todo) => void
  }) => (
    <div>
      <p>
        list loading={String(props.loading)} failed={String(props.failed)}{' '}
        hasTodos={String(props.hasTodos)}
      </p>
      <button onClick={() => props.onToggle(mockTodo)}>toggle</button>
      <button onClick={() => props.onEdit(mockTodo)}>edit</button>
      <button onClick={() => props.onDelete(mockTodo)}>delete</button>
    </div>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: ({
    todo,
    onClose,
    onSaved,
  }: {
    todo: Todo | 'new'
    onClose: () => void
    onSaved: (notice: string) => void
  }) => (
    <div>
      <p>editor {todo === 'new' ? 'new' : `todo ${todo.id}`}</p>
      <button onClick={onClose}>close editor</button>
      <button onClick={() => onSaved('Task saved.')}>save editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: ({
    onClose,
    onDeleted,
  }: {
    onClose: () => void
    onDeleted: () => void
  }) => (
    <div>
      <p>delete dialog</p>
      <button onClick={onClose}>close delete</button>
      <button onClick={onDeleted}>confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

const mockTodo = { ...todoFixture }

const notify = vi.fn()
const reset = vi.fn()
const refetch = vi.fn()
const mutateAsync = vi.fn()

function setup({
  query = {},
  busy = false,
  mutationError = null,
}: {
  query?: Record<string, unknown>
  busy?: boolean
  mutationError?: Error | null
} = {}) {
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [mockTodo],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch,
    ...query,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [mockTodo],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  return render(<TodosPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  refetch.mockResolvedValue(undefined)
})

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  setup({
    query: {
      data: [],
      isError: true,
      error: new Error('The server is unavailable.'),
    },
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('shows no alert when nothing failed', () => {
  setup()
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
})

it('prefers the mutation error over the query error', () => {
  setup({
    query: { error: new Error('query'), isError: true },
    mutationError: new Error('Could not update.'),
  })
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not update.')
})

it('disables retry while a request is fetching', () => {
  setup({ query: { error: new Error('x'), isError: true, isFetching: true } })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
})

it('passes loading state and task presence to the list and disables creation', () => {
  setup({ query: { data: undefined, isPending: true } })
  expect(
    screen.getByText(/loading=true failed=false hasTodos=false/),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
})

it('disables creation while another mutation is busy', () => {
  setup({ busy: true })
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
})

it.each([
  [true, 'Another task complete. Well done!'],
  [false, 'Task marked as active.'],
])(
  'toggles a task and notifies when the saved task is completed=%s',
  async (completed, message) => {
    const user = userEvent.setup()
    mutateAsync.mockResolvedValue({ ...mockTodo, completed })
    setup()
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(mutateAsync).toHaveBeenCalledWith({
      id: mockTodo.id,
      input: { completed: !mockTodo.completed },
    })
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message))
  },
)

it('ignores toggles while busy', async () => {
  const user = userEvent.setup()
  setup({ busy: true })
  await user.click(screen.getByRole('button', { name: 'toggle' }))
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('does not notify when toggling fails', async () => {
  const user = userEvent.setup()
  mutateAsync.mockRejectedValue(new Error('fail'))
  setup()
  await user.click(screen.getByRole('button', { name: 'toggle' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
})

it('opens the editor for a new task and closes it without notifying', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.queryByText(/^editor/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'New task' }))
  expect(screen.getByText('editor new')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'close editor' }))
  expect(screen.queryByText(/^editor/)).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it('opens the editor for an existing task and notifies after saving', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'edit' }))
  expect(screen.getByText(`editor todo ${mockTodo.id}`)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'save editor' }))
  expect(screen.queryByText(/^editor/)).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task saved.')
})

it('opens the delete dialog, cancels, and notifies after deleting', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.queryByText('delete dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'delete' }))
  await user.click(screen.getByRole('button', { name: 'close delete' }))
  expect(screen.queryByText('delete dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'delete' }))
  await user.click(screen.getByRole('button', { name: 'confirm delete' }))
  expect(screen.queryByText('delete dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})
