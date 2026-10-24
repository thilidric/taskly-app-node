import { Badge, Card, Text } from '../../../design-system'
import type { Todo } from '../types'
import { summarizeTodos } from '../utils/todos'

export function TodoSummary({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null
  const summary = summarizeTodos(todos)
  return (
    <Card>
      <section className="stack compact" aria-label="Task progress">
        <div className="row spread">
          <Text>
            {summary.active === 0
              ? 'All tasks complete. Nice work!'
              : `${summary.completed} of ${summary.total} ${summary.total === 1 ? 'task' : 'tasks'} completed`}
          </Text>
          {summary.overdue > 0 && (
            <Badge variant="warning">{summary.overdue} overdue</Badge>
          )}
        </div>
        <progress
          className="progress"
          max={100}
          value={summary.percentComplete}
          aria-label={`${summary.percentComplete}% of tasks completed`}
        />
      </section>
    </Card>
  )
}
