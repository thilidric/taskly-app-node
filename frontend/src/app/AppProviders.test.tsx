import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { expect, it } from 'vitest'
import { theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

function Probe({
  onRead,
}: {
  onRead: (client: QueryClient, value: unknown) => void
}) {
  onRead(useQueryClient(), useTheme())
  return <p>probe</p>
}

it('provides the given query client and the design-system theme', () => {
  const client = new QueryClient()
  let seen: [QueryClient, unknown] | undefined
  render(
    <AppProviders client={client}>
      <Probe onRead={(c, t) => (seen = [c, t])} />
    </AppProviders>,
  )
  expect(screen.getByText('probe')).toBeInTheDocument()
  expect(seen?.[0]).toBe(client)
  expect(seen?.[1]).toBe(theme)
})

it('falls back to the shared query client', () => {
  let seen: QueryClient | undefined
  render(
    <AppProviders>
      <Probe onRead={(c) => (seen = c)} />
    </AppProviders>,
  )
  expect(seen).toBe(queryClient)
})
