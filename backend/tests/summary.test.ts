import { describe, it, expect } from 'vitest';
import { summarize } from '../src/features/todos/summary.ts';
import { todo } from './fixture.ts';

const today = '2026-10-15';

describe('summarize', () => {
  it('returns zeros for an empty list without dividing by zero', () => {
    expect(summarize([], today)).toEqual({ total: 0, completed: 0, active: 0, overdue: 0, percentComplete: 0, byPriority: { low: 0, medium: 0, high: 0 } });
  });
  it('counts completed and active tasks and rounds the percentage', () => {
    const todos = [{ ...todo, completed: true }, { ...todo, id: 2 }, { ...todo, id: 3 }];
    const summary = summarize(todos, today);
    expect(summary).toMatchObject({ total: 3, completed: 1, active: 2, percentComplete: 33 });
    expect(summarize([todos[0], todos[0], todos[1]], today).percentComplete).toBe(67);
  });
  it('counts only active tasks per priority', () => {
    const todos = [
      { ...todo, priority: 'low' as const }, { ...todo, priority: 'medium' as const }, { ...todo, priority: 'medium' as const },
      { ...todo, priority: 'high' as const, completed: true },
    ];
    expect(summarize(todos, today).byPriority).toEqual({ low: 1, medium: 2, high: 0 });
  });
  it('counts overdue only for active tasks due strictly before today', () => {
    const todos = [
      { ...todo, due_date: '2026-10-14' },
      { ...todo, due_date: '2026-10-15' },
      { ...todo, due_date: '2026-10-16' },
      { ...todo, due_date: null },
      { ...todo, due_date: '2026-10-01', completed: true },
    ];
    expect(summarize(todos, today).overdue).toBe(1);
  });
});
