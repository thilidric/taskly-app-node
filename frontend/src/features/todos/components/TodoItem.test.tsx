import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('forwards toggle and delete for a completed task', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  const todo = { ...todoFixture, completed: true }
  render(
    <TodoItem
      todo={todo}
      busy={false}
      onEdit={vi.fn()}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByText('Completed')).toBeVisible()
  await user.click(
    screen.getByRole('checkbox', { name: `Mark as active: ${todo.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todo.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('disables every action while busy', () => {
  render(
    <TodoItem
      todo={todoFixture}
      busy
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: /^Edit:/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^Delete:/ })).toBeDisabled()
})

it('shows the description, id and a formatted due date', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  try {
    const todo = {
      ...todoFixture,
      description: 'Line one',
      due_date: '2026-10-20',
    }
    render(
      <TodoItem
        todo={todo}
        busy={false}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Line one')).toBeVisible()
    expect(screen.getByText(`#${todo.id}`)).toBeVisible()
    expect(screen.getByText('20 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

it('marks an active task past its due date as overdue', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  try {
    render(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-10' }}
        busy={false}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/10 Oct 2026/)).toHaveTextContent('overdue')
  } finally {
    vi.useRealTimers()
  }
})
