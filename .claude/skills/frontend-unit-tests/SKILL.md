---
name: frontend-unit-tests
description: Conventions and proven patterns for writing Vitest + React Testing Library unit tests in the Taskly frontend (React 19, TanStack Query, styled-components design system). Use before creating or editing any frontend/src test file.
when_to_use: Writing or fixing tests for React components, hooks, TanStack Query mutations, the fetch wrapper, or utilities under frontend/src.
user-invocable: true
---

# Frontend unit tests (frontend/)

Stack: Vitest 4 (`jsdom`), React Testing Library 16, `@testing-library/user-event`
14, `@testing-library/jest-dom` (set up in `src/test/setup.ts`, which also runs
`cleanup`). TanStack Query 5. Styling is styled-components through
`src/design-system`.

## Conventions (match them exactly)

- **Location:** co-located, `Foo.tsx` → `Foo.test.tsx`, `foo.ts` → `foo.test.ts`.
- **Imports:** import test APIs explicitly:
  `import { beforeEach, describe, expect, it, vi } from 'vitest'`.
- **Style:** Prettier with no semicolons, single quotes and trailing commas. Run
  the `format` command of the run-unit-tests skill on every file you touch.
- **Fixtures:** `todoFixture` from `src/test/todoFixture.ts`. Derive variants
  with spread (`{ ...todoFixture, completed: true }`). Never mutate the fixture.
- **Queries:** `getByRole(…, { name })` first, then `getByLabelText` and
  `getByText`. The only test id is `alert`, provided by the design-system mock.
- **Interaction:** `const user = userEvent.setup()` at the top of the test,
  then `await user.click(…)`. Never use `fireEvent` for user actions.
- **Async:** `await waitFor(() => expect(…))` or `findBy…` for effects that
  resolve after a promise.
- Flat `it(...)` at top level is common here. Use `describe` only to group
  several cases of one unit.

## Mock the design system in component tests

Real design-system components need a ThemeProvider. Component tests replace
them with lightweight native-element mocks. Each mock is a `vi.fn`, so props can
be asserted:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
beforeEach(() => vi.clearAllMocks()) // required when asserting on mock calls

expect(vi.mocked(Alert).mock.calls[0][0]).toEqual(expect.objectContaining({ variant: 'success' }))
```

The relative path must point from the test file to `src/design-system`. Mocks
render: `Button`/`IconButton` → `<button>`, `Input` → `<label>{label}<input|textarea/>{error}</label>`,
`Select` → `<label>{label}<select>…</select></label>`, `Checkbox` → `<label><input type="checkbox"/></label>`,
`Drawer` → `<div role="dialog" aria-label={title}>` with a `Close` button (only when `isOpen`),
`Heading` → `<h{level}>`, `Text` → `<p>` or `as`, `Alert` → `<div data-testid="alert">`, `Card` → `<div>`, `Badge` → `<span>`.
Read `src/design-system/mocks.tsx` if a detail matters. Never edit it.

## Choose the right level of isolation

| Unit under test | Mock | Keep real |
| --- | --- | --- |
| Presentational component (`TodoItem`, `TodoFilters`) | design system | everything else |
| Container component (`TodosPage`, `TodoEditor`, `DeleteTodoDialog`) | design system, child components, data hooks | the component's own logic |
| Query or mutation hook (`useCreateTodoMutation`) | `todosApi` (`../api/todos`) | TanStack Query with a fresh `QueryClient` |
| `todosApi` | `request` from `lib/http` | — |
| `lib/http` `request` | global `fetch` (`vi.stubGlobal`) | — |
| Pure utils (`utils/todos.ts`) | nothing (fake the clock for dates) | — |

The patterns for each row are in [patterns.md](patterns.md). Read the relevant
section before writing. They are verified against this code base.

## Pitfalls seen in this repo

- `vi.mock` is hoisted. Factories cannot use variables from the test file unless
  the variable names start with `mock` or come from `vi.hoisted`. Configure
  per-test behaviour with `vi.mocked(fn).mockReturnValue(…)` instead.
- Mocked hooks return partial objects. Cast as the existing tests do:
  `as unknown as ReturnType<typeof useDeleteTodoMutation>`.
- `TodoForm` renders `required` inputs inside a `noValidate` form, and the label
  text includes ` *` (`/Task title/` regex).
- Dates: `isOverdue` uses the **local** current date and `formatDate` uses
  `en-GB`. Fake time with `vi.useFakeTimers({ toFake: ['Date'] })` plus
  `vi.setSystemTime(…)`, so `userEvent` and `waitFor` keep working, and
  restore with `vi.useRealTimers()`.
- `useNotice` clears after 4000 ms. Use fake timers and
  `act(() => vi.advanceTimersByTime(4000))`.
- Never hit the network. An unmocked `fetch` in jsdom fails or hangs.
