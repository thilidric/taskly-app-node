import type { Todo } from './types.js';

export interface TodoSummary {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  percentComplete: number;
  byPriority: Record<Todo['priority'], number>;
}

/** Aggregates task counts. `today` is a calendar date (YYYY-MM-DD) in UTC. */
export function summarize(todos: Todo[], today = new Date().toISOString().slice(0, 10)): TodoSummary {
  const summary: TodoSummary = {
    total: todos.length, completed: 0, active: 0, overdue: 0, percentComplete: 0,
    byPriority: { low: 0, medium: 0, high: 0 },
  };
  for (const todo of todos) {
    if (todo.completed) summary.completed++;
    else {
      summary.active++;
      summary.byPriority[todo.priority]++;
      if (todo.due_date && todo.due_date < today) summary.overdue++;
    }
  }
  summary.percentComplete = todos.length ? Math.round((summary.completed / todos.length) * 100) : 0;
  return summary;
}
