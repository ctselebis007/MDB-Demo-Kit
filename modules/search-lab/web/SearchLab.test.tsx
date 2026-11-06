import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchLab } from './SearchLab'

const hit = (id: string, rank: number) => ({
  id,
  rank,
  score: 1 / rank,
  title: `Product ${id}`,
  description: 'desc',
  category: 'footwear',
  brand: 'B',
  price: 10,
  highlights: [],
  score_details: null,
})
const column = (...ids: string[]) => ({
  results: ids.map((id, i) => hit(id, i + 1)),
  pipeline: [{ $limit: 10 }],
  timings: { server_ms: 5, embed_ms: null, rerank_ms: null },
  explain: null,
})
const response = {
  text: column('a', 'b'),
  vector: column('b', 'a'),
  hybrid: column('a', 'b'),
  rerank: null,
  rerank_reason: 'Reranking uses Voyage rerank-3. Switch the provider to Voyage AI on Setup.',
  errors: {},
}

function setup() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/facets')) return new Response(JSON.stringify({ categories: ['footwear'], price_min: 1, price_max: 9 }))
    const body = JSON.parse(String(init?.body))
    const r = body.explain ? { ...response, text: { ...column('a'), explain: { stages: [] } } } : response
    return new Response(JSON.stringify(r))
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SearchLab />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('SearchLab', () => {
  it('renders columns, cross-highlights on hover and disables rerank with a tooltip', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const rerank = await screen.findByRole('region', { name: 'Hybrid + Rerank' })
    expect(rerank).toHaveAttribute('title', expect.stringContaining('Voyage'))
    expect(within(rerank).getByText(/Switch the provider/)).toBeInTheDocument()

    await user.hover(await screen.findByTestId('text-b'))
    expect(screen.getByTestId('vector-b')).toHaveAttribute('data-hovered', 'true')
    expect(screen.getByTestId('vector-a')).toHaveAttribute('data-hovered', 'false')
  })

  it('explain toggle re-runs the column with explain=true', async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const text = await screen.findByRole('region', { name: 'Full-text' })
    await user.click(await within(text).findByRole('button', { name: 'Query' }))
    await user.click(screen.getByLabelText('Explain'))
    const bodies = fetchMock.mock.calls
      .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
      .filter(Boolean)
    expect(bodies.at(-1)).toMatchObject({ explain: true, only: 'text', q: 'waterproof boots for rainy hikes' })
    expect(await screen.findByText(/stages/)).toBeInTheDocument()
  })
})
