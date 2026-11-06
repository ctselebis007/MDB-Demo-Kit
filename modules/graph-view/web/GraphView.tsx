import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, type Schemas } from '../../core/api'
import { QueryDrawer } from '../../core/QueryDrawer'
import { toastError } from '../../core/toast'
import { DEPTH_COLORS, ForceGraph } from './ForceGraph'
import { mergeGraph, toGraph, type Graph } from './graph'

type ExploreResponse = Schemas['ExploreResponse']
type EdgeType = 'all' | 'supplies' | 'component_of' | 'sold_to'
type NodeType = 'supplier' | 'part' | 'product' | 'customer'

interface ExploreRequest {
  query?: string
  start_ids?: string[]
  max_depth: number
  edge_type: EdgeType
  restrict_types?: NodeType[] | null
  explain?: boolean
}

const NODE_TYPES: { type: NodeType; label: string; symbol: string }[] = [
  { type: 'supplier', label: 'Supplier', symbol: '●' },
  { type: 'part', label: 'Part', symbol: '■' },
  { type: 'product', label: 'Product', symbol: '◆' },
  { type: 'customer', label: 'Customer', symbol: '▲' },
]
const EDGE_TYPES: { value: EdgeType; label: string }[] = [
  { value: 'all', label: 'All edges' },
  { value: 'supplies', label: 'supplies (supplier → part)' },
  { value: 'component_of', label: 'component of (part → product)' },
  { value: 'sold_to', label: 'sold to (product → customer)' },
]
const URL_EXPLORE = '/api/graph-view/explore'
const explore = (req: ExploreRequest) => api.post<ExploreResponse>(URL_EXPLORE, req)

export function GraphView() {
  const [query, setQuery] = useState('battery cell suppliers with sustainable sourcing')
  const [depth, setDepth] = useState(2)
  const [edge, setEdge] = useState<EdgeType>('all')
  const [types, setTypes] = useState<NodeType[]>(NODE_TYPES.map((t) => t.type))
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] })
  const [last, setLast] = useState<{ req: ExploreRequest; resp: ExploreResponse } | null>(null)
  const [drawer, setDrawer] = useState(false)

  const restrict = types.length === NODE_TYPES.length ? null : types

  const search = useMutation({
    mutationFn: explore,
    onSuccess: (resp, req) => {
      setGraph(toGraph(resp))
      setLast({ req, resp })
    },
    onError: toastError,
  })
  const expand = useMutation({
    mutationFn: ({ req }: { req: ExploreRequest; id: string }) => explore(req),
    onSuccess: (resp, { req, id }) => {
      setGraph((g) => mergeGraph(g, toGraph(resp), id))
      setLast({ req, resp })
    },
    onError: toastError,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) search.mutate({ query: query.trim(), max_depth: depth, edge_type: edge, restrict_types: restrict })
  }
  const onNodeClick = (id: string) =>
    expand.mutate({ id, req: { start_ids: [id], max_depth: 0, edge_type: edge, restrict_types: restrict } })
  const toggleType = (t: NodeType) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex gap-2">
          <input
            aria-label="Graph query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
            placeholder="Ask about suppliers, parts, products or customers…"
          />
          <button type="submit" disabled={search.isPending} className="bg-mdb-forest rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {search.isPending ? 'Exploring…' : 'Explore'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            Max depth
            <input type="range" min={0} max={4} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Max depth" />
            <span className="font-mono">{depth}</span>
          </label>
          <label className="flex items-center gap-2">
            Edge
            <select value={edge} onChange={(e) => setEdge(e.target.value as EdgeType)} className="rounded border border-slate-300 px-2 py-0.5">
              {EDGE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Node types to traverse</legend>
            {NODE_TYPES.map((t) => (
              <label key={t.type} className="flex items-center gap-1">
                <input type="checkbox" checked={types.includes(t.type)} onChange={() => toggleType(t.type)} />
                <span aria-hidden>{t.symbol}</span> {t.label}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="text-mdb-forest ml-auto text-sm underline disabled:opacity-40"
            disabled={!last}
            onClick={() => setDrawer(true)}
          >
            Query
          </button>
        </div>
      </form>

      <div className="flex items-center gap-4 text-xs text-slate-600">
        <span>Depth:</span>
        {DEPTH_COLORS.slice(0, 5).map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />
            {i === 0 ? 'start' : i}
          </span>
        ))}
        <span className="ml-auto">
          {graph.nodes.length} nodes · {graph.links.length} links · click a node to expand · drag / scroll to zoom
        </span>
      </div>

      {graph.nodes.length > 0 ? (
        <ForceGraph nodes={graph.nodes} links={graph.links} onNodeClick={onNodeClick} />
      ) : (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
          Run a query: $vectorSearch picks 3 start nodes, then $graphLookup walks the supply chain.
        </div>
      )}

      {drawer && last && (
        <QueryDrawer
          key={JSON.stringify(last.req)}
          open
          onClose={() => setDrawer(false)}
          title="$vectorSearch → $graphLookup"
          pipeline={last.resp.pipeline}
          timings={last.resp.timings}
          fetchExplain={() => explore({ ...last.req, explain: true }).then((r) => r.explain)}
        />
      )}
    </div>
  )
}
