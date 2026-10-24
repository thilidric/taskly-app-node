import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const active = { ...todoFixture, id: 1, title: 'Write docs' }
const done = { ...todoFixture, id: 2, title: 'Ship release', completed: true }

it('starts with all tasks, no search and newest sort', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toHaveLength(2)
})

it('narrows visible tasks by status and search text', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])
  act(() => result.current.setFilter('all'))
  act(() => result.current.setSearch('docs'))
  expect(result.current.visible).toEqual([active])
})

it('reorders visible tasks when the sort changes', () => {
  const high = { ...active, id: 3, priority: 'high' as const }
  const { result } = renderHook(() => useTodoFilters([active, high]))
  act(() => result.current.setSort('priority'))
  expect(result.current.visible.map((todo) => todo.id)).toEqual([3, 1])
})
