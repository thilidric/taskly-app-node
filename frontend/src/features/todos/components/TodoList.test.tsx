import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: () => <p>Empty task list</p>,
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: { id: number }
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      Task {todo.id}
      <button onClick={onToggle}>toggle</button>
      <button onClick={onEdit}>edit</button>
      <button onClick={onDelete}>delete</button>
    </li>
  ),
}))

const props = {
  todos: [],
  hasTodos: false,
  loading: false,
  failed: false,
  busy: false,
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

it('shows loading feedback before showing an empty list', () => {
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('shows an unavailable message when loading failed and nothing is cached', () => {
  render(<TodoList {...props} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
})

it('keeps showing cached tasks when a refetch failed', () => {
  render(<TodoList {...props} failed hasTodos todos={[todoFixture]} />)
  expect(screen.getByText(`Task ${todoFixture.id}`)).toBeVisible()
  expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument()
})

it('binds each item callback to its own task', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoList
      {...props}
      hasTodos
      todos={[todoFixture]}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'toggle' }))
  await user.click(screen.getByRole('button', { name: 'edit' }))
  await user.click(screen.getByRole('button', { name: 'delete' }))
  expect(onToggle).toHaveBeenCalledWith(todoFixture)
  expect(onEdit).toHaveBeenCalledWith(todoFixture)
  expect(onDelete).toHaveBeenCalledWith(todoFixture)
})
