import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoSummary } from './TodoSummary'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
  })
  afterEach(() => vi.useRealTimers())

  const active = { ...todoFixture, id: 1, completed: false, due_date: null }
  const done = { ...todoFixture, id: 2, completed: true, due_date: null }

  it('renders nothing when there are no tasks', () => {
    const { container } = render(<TodoSummary todos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows progress text and a progress bar', () => {
    render(<TodoSummary todos={[active, done, { ...done, id: 3 }]} />)
    expect(screen.getByText('2 of 3 tasks completed')).toBeVisible()
    expect(screen.getByLabelText('67% of tasks completed')).toHaveAttribute(
      'value',
      '67',
    )
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })

  it('uses the singular noun for a single task', () => {
    render(<TodoSummary todos={[active]} />)
    expect(screen.getByText('0 of 1 task completed')).toBeVisible()
  })

  it('congratulates when all tasks are complete', () => {
    render(<TodoSummary todos={[done]} />)
    expect(screen.getByText('All tasks complete. Nice work!')).toBeVisible()
    expect(screen.getByLabelText('100% of tasks completed')).toBeVisible()
  })

  it('shows an overdue badge with the count', () => {
    const late = { ...active, id: 4, due_date: '2026-10-14' }
    render(<TodoSummary todos={[late, { ...late, id: 5 }, done]} />)
    expect(screen.getByText('2 overdue')).toBeVisible()
  })
})
