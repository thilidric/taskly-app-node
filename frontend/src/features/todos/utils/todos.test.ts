import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { TodoInput } from '../types'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('breaks priority ties with the newest id first', () => {
    const older = { ...base, id: 1 }
    const newer = { ...base, id: 2 }
    expect(selectTodos([older, newer], 'all', '', 'priority')).toEqual([
      newer,
      older,
    ])
  })

  it('sorts by due date with undated tasks last', () => {
    const undated = { ...base, id: 1 }
    const late = { ...base, id: 2, due_date: '2026-12-01' }
    const early = { ...base, id: 3, due_date: '2026-11-01' }
    expect(selectTodos([undated, late, early], 'all', '', 'due')).toEqual([
      early,
      late,
      undated,
    ])
  })

  it('sorts newest first by creation time, then by id', () => {
    const old = { ...base, id: 1, created_at: '2026-09-01T00:00:00Z' }
    const recent = { ...base, id: 2 }
    const sameTime = { ...base, id: 3 }
    expect(selectTodos([old, recent, sameTime], 'all', '', 'newest')).toEqual([
      sameTime,
      recent,
      old,
    ])
  })

  it('filters completed tasks', () => {
    const done = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })
})

const validInput: TodoInput = {
  title: 'Plan',
  description: '',
  priority: 'medium',
  due_date: null,
  completed: false,
}

describe('validateTodo', () => {
  it('accepts a valid task', () => {
    expect(validateTodo({ ...validInput, due_date: '2026-02-28' })).toEqual({})
  })

  it('rejects a whitespace-only title', () => {
    expect(validateTodo({ ...validInput, title: '   ' })).toEqual({
      title: 'Enter a task title.',
    })
  })

  it('limits the trimmed title to 120 characters', () => {
    expect(validateTodo({ ...validInput, title: 'x'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...validInput, title: 'x'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
  })

  it('limits the description to 2000 characters', () => {
    expect(
      validateTodo({ ...validInput, description: 'x'.repeat(2001) }),
    ).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it.each(['2026-02-30', '2026-13-01', '26-01-01', 'tomorrow'])(
    'rejects the invalid due date %s',
    (due_date) => {
      expect(validateTodo({ ...validInput, due_date })).toEqual({
        due_date: 'Enter a valid date.',
      })
    },
  )
})

describe('isOverdue and formatDate', () => {
  afterEach(() => vi.useRealTimers())

  function setToday() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
  }

  it('flags an active task due before today', () => {
    setToday()
    expect(isOverdue({ ...base, due_date: '2026-10-14' })).toBe(true)
  })

  it('does not flag tasks due today, undated or completed', () => {
    setToday()
    expect(isOverdue({ ...base, due_date: '2026-10-15' })).toBe(false)
    expect(isOverdue(base)).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-01', completed: true }),
    ).toBe(false)
  })

  it('formats dates in en-GB style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
