import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryPanel, SetupPage, buildUpdate, type FormState } from './SetupPage'

const masked = {
  mongo_uri: 'mongodb+srv://alice:••••@cluster0.mongodb.net/',
  db_name: 'demo',
  provider: 'voyage',
  model: 'voyage-4',
  dims: 1024,
  has_uri: true,
  has_key: true,
  key_last4: 'abcd',
  voyage_base_url: 'https://ai.mongodb.com',
  models: {
    voyage: { 'voyage-4': 1024, 'voyage-4-large': 1024 },
    openai: { 'text-embedding-3-small': 1536, 'text-embedding-3-large': 3072 },
  },
}
const status = { configured: true, reachable: true, seeded: false, indexed: false, reseed_required: false, meta: null, modules: [], error: null }

afterEach(() => vi.unstubAllGlobals())

describe('buildUpdate', () => {
  const form: FormState = {
    mongo_uri: '',
    api_key: '   ',
    db_name: 'demo',
    provider: 'voyage',
    model: 'voyage-4',
    voyage_base_url: 'https://ai.mongodb.com',
  }

  it('sends no value for blank secret fields', () => {
    const u = buildUpdate(form)
    expect(u).not.toHaveProperty('mongo_uri')
    expect(u).not.toHaveProperty('api_key')
  })

  it('sends typed secrets', () => {
    expect(buildUpdate({ ...form, api_key: 'pa-x' }).api_key).toBe('pa-x')
  })
})

describe('SetupPage', () => {
  it('provider change updates model options and dims', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/status') ? status : masked))),
    )
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SetupPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('dims')).toHaveTextContent('1024 dimensions')
    expect(screen.getByLabelText('MongoDB URI')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('MongoDB URI')).toHaveAttribute('autocomplete', 'off')

    await user.selectOptions(screen.getByLabelText('Embedding provider'), 'openai')
    const options = Array.from((screen.getByLabelText('Model') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['text-embedding-3-small', 'text-embedding-3-large'])
    expect(screen.getByTestId('dims')).toHaveTextContent('1536 dimensions')
  })

  it('explains how to add a module and disables seeding when none are installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/status') ? status : masked))),
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SetupPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('note')).toHaveTextContent('No feature modules yet')
    expect(screen.getByRole('button', { name: 'Seed Database' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create Indexes' })).toBeDisabled()
  })

  it('shows database, collection and index status after Test Connections', async () => {
    const inventory = {
      reachable: true,
      db_name: 'demo',
      db_exists: true,
      modules: ['search-lab'],
      collections: [
        {
          name: 'products',
          module: 'search-lab',
          exists: true,
          count: 500,
          indexes: [
            { name: 'category_price', kind: 'regular', status: 'ready', detail: '' },
            { name: 'products_vector', kind: 'vectorSearch', status: 'missing', detail: '' },
          ],
        },
        { name: 'reviews', module: 'search-lab', exists: false, count: null, indexes: [] },
      ],
      other_collections: ['legacy'],
      error: null,
    }
    const fetch = vi.fn(async (url: string) => {
      const body = url.endsWith('/status')
        ? { ...status, modules: ['search-lab'] }
        : url.endsWith('/inventory')
          ? inventory
          : url.endsWith('/test')
            ? { rows: [] }
            : masked
      return new Response(JSON.stringify(body))
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SetupPage />
      </QueryClientProvider>,
    )
    const panel = await screen.findByTestId('inventory')
    expect(panel).toHaveTextContent('Click Test Connections')
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/inventory'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Test Connections' }))
    expect(await screen.findByTestId('inventory-summary')).toHaveTextContent('1/2 collections · 1/2 indexes ready')
    expect(screen.getByTestId('collection-products')).toHaveTextContent('500 docs')
    expect(screen.getByTestId('collection-products')).toHaveTextContent('products_vector · Vector Search')
    expect(screen.getByTestId('collection-reviews')).toHaveTextContent('missing')
    expect(screen.getByTestId('collection-reviews')).toHaveTextContent('No indexes declared.')
    expect(panel).toHaveTextContent('Other collections in this database: legacy')
  })
})

describe('InventoryPanel', () => {
  it('says nothing is expected when no modules are installed', () => {
    render(
      <InventoryPanel
        pending={false}
        inventory={{ reachable: true, db_name: 'demo', db_exists: false, modules: [], collections: [], other_collections: [], error: null }}
      />,
    )
    expect(screen.getByTestId('inventory')).toHaveTextContent('not created')
    expect(screen.getByTestId('inventory')).toHaveTextContent('No modules installed')
  })
})
