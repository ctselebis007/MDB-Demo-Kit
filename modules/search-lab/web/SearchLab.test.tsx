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
    expect(within(screen.getByTestId('text-b')).getByTitle('Vector: rank #1')).toBeInTheDocument()
    expect(within(screen.getByTestId('text-b')).getByTitle('Hybrid + Rerank: not in top results')).toBeInTheDocument()
  })

  it('click pins a result across columns until clicked again or cleared', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByTestId('text-b'))
    await user.unhover(screen.getByTestId('text-b'))
    await user.hover(screen.getByTestId('vector-a'))
    expect(screen.getByTestId('hybrid-b')).toHaveAttribute('data-hovered', 'true')
    expect(screen.getByTestId('hybrid-a')).toHaveAttribute('data-hovered', 'false')

    await user.click(screen.getByRole('button', { name: 'clear pin' }))
    expect(screen.getByTestId('hybrid-b')).toHaveAttribute('data-pinned', 'false')
    expect(screen.getByTestId('hybrid-a')).toHaveAttribute('data-hovered', 'false')

    await user.click(screen.getByTestId('vector-a'))
    await user.click(screen.getByTestId('vector-a'))
    expect(screen.getByTestId('text-a')).toHaveAttribute('data-pinned', 'false')
  })

  it('each column toggles its aggregation pipeline and copies the exact JSON', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    setup()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    for (const name of ['Full-text', 'Vector', 'Hybrid']) {
      const region = await screen.findByRole('region', { name })
      const toggle = within(region).getByRole('button', { name: /show aggregation pipeline/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await user.click(toggle)
      expect(within(region).getByRole('button', { name: /hide aggregation pipeline/i })).toHaveAttribute('aria-expanded', 'true')
      expect(within(region).getByText(/"\$limit": 10/)).toBeInTheDocument()
    }
    const text = screen.getByRole('region', { name: 'Full-text' })
    await user.click(within(text).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify([{ $limit: 10 }], null, 2))
  })

  it('explain re-runs the column with explain=true', async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const text = await screen.findByRole('region', { name: 'Full-text' })
    await user.click(within(text).getByRole('button', { name: /show aggregation pipeline/i }))
    await user.click(within(text).getByRole('button', { name: 'Explain…' }))
    await user.click(screen.getByLabelText('Explain'))
    const bodies = fetchMock.mock.calls
      .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
      .filter(Boolean)
    expect(bodies.at(-1)).toMatchObject({ explain: true, only: 'text', q: 'waterproof boots for rainy hikes' })
    expect(await screen.findByText(/stages/)).toBeInTheDocument()
  })
})
