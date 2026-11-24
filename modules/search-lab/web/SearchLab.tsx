import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { api, type Schemas } from '../../core/api'
import { QueryDrawer, abbreviate } from '../../core/QueryDrawer'
import { COLUMN_KEYS, rankIndex, type ColumnKey, type RankIndex } from './crossHighlight'

type Response = Schemas['SearchLabResponse']
type Column = NonNullable<Response['text']>
type Hit = Schemas['ProductHit']
type Facets = Schemas['Facets']

export interface QueryRequest {
  q: string
  filters: { categories: string[]; price_min: number | null; price_max: number | null }
  text_weight: number
  explain?: boolean
  only?: ColumnKey
}

const QUERY_URL = '/api/search-lab/query'

const COLUMNS: Record<ColumnKey, { title: string; subtitle: string; short: string; color: string }> = {
  text: { title: 'Full-text', subtitle: '$search · fuzzy · highlights', short: 'FTS', color: '#016bf8' },
  vector: { title: 'Vector', subtitle: '$vectorSearch · pre-filters', short: 'VEC', color: '#7c3aed' },
  hybrid: { title: 'Hybrid', subtitle: '$rankFusion', short: 'HYB', color: '#00a35c' },
  rerank: { title: 'Hybrid + Rerank', subtitle: 'Voyage rerank-3', short: 'RR', color: '#e8590c' },
}

function ModeDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />
}

function RankChips({ col, ranks }: { col: ColumnKey; ranks: Partial<Record<ColumnKey, number>> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {COLUMN_KEYS.map((k) => {
        const { title, short, color } = COLUMNS[k]
        const r = ranks[k]
        const self = k === col
        return (
          <span
            key={k}
            title={r ? `${title}: rank #${r}` : `${title}: not in top results`}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold whitespace-nowrap ${r ? '' : 'border-dashed opacity-35'}`}
            style={{ borderColor: color, color: self ? '#fff' : color, background: self ? color : '#fff' }}
          >
            {short} {r ? `#${r}` : '–'}
          </span>
        )
      })}
    </div>
  )
}

export function explainQuery(req: QueryRequest, col: ColumnKey) {
  return api.post<Response>(QUERY_URL, { ...req, explain: true, only: col }).then((r) => r[col]?.explain ?? null)
}

function Highlighted({ hit, path, fallback }: { hit: Hit; path: string; fallback: string }) {
  const h = hit.highlights.find((x) => x.path === path) as
    | { texts: { value: string; type: 'hit' | 'text' }[] }
    | undefined
  if (!h) return <>{fallback}</>
  return (
    <>
      {h.texts.map((t, i) =>
        t.type === 'hit' ? (
          <mark key={i} className="bg-mdb-green/40 rounded px-0.5">
            {t.value}
          </mark>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </>
  )
}

function ResultColumn(props: {
  col: ColumnKey
  data: Column | null | undefined
  error?: { message: string; hint: string }
  disabledReason?: string | null
  loading: boolean
  ranks: RankIndex
  focused: string | null
  pinned: string | null
  onHover: (id: string | null) => void
  onPin: (id: string) => void
  onExplain: () => void
}) {
  const { col, data, error, disabledReason, ranks, focused, pinned, onHover, onPin } = props
  const meta = COLUMNS[col]
  const disabled = !!disabledReason
  const click = (e: MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('a, button, details, summary')) return
    onPin(id)
  }
  return (
    <section
      aria-label={meta.title}
      title={disabledReason ?? undefined}
      className={`flex min-w-0 flex-col rounded-lg border border-t-4 bg-white ${disabled ? 'border-dashed border-slate-300 opacity-60' : 'border-slate-200'}`}
      style={{ borderTopColor: meta.color }}
    >
      <header className="flex items-start justify-between border-b border-slate-100 px-3 py-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold" style={{ color: meta.color }}>
            <ModeDot color={meta.color} />
            {meta.title}
          </h2>
          <p className="font-mono text-xs text-slate-500">{meta.subtitle}</p>
        </div>
        <div className="text-right">
          {data && <p className="text-xs text-slate-500">{data.timings.server_ms.toFixed(0)} ms</p>}
        </div>
      </header>
      {disabled && <p className="p-3 text-sm text-slate-600">{disabledReason}</p>}
      {error && (
        <p className="p-3 text-sm text-red-700">
          {error.message} <span className="text-slate-600">{error.hint}</span>
        </p>
      )}
      {props.loading && !data && !disabled && <p className="p-3 text-sm text-slate-400">Searching…</p>}
      <ol className="space-y-1.5 p-2">
        {data?.results.map((hit) => {
          const isFocused = focused === hit.id
          const isPinned = pinned === hit.id
          return (
            <li
              key={hit.id}
              data-testid={`${col}-${hit.id}`}
              data-hovered={isFocused}
              data-pinned={isPinned}
              onMouseEnter={() => onHover(hit.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => click(e, hit.id)}
              className={`cursor-pointer rounded-md border-l-[3px] px-2 py-1.5 text-sm transition-[background-color,opacity] duration-150 ${
                isFocused
                  ? `border-l-[#e0b400] bg-[#fff2a8] ${isPinned ? 'shadow-[inset_0_0_0_2px_#e0b400]' : 'shadow-[inset_0_0_0_1px_#e0b400]'}`
                  : `border-l-transparent hover:bg-slate-50 ${focused ? 'opacity-45' : ''}`
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center self-start rounded-full px-1 text-[11px] font-semibold text-white"
                  style={{ background: meta.color }}
                >
                  {hit.rank}
                </span>
                <p className="flex-1 font-medium">
                  <Highlighted hit={hit} path="title" fallback={hit.title} />
                </p>
                <span className="font-mono text-xs text-slate-500">{hit.score.toFixed(3)}</span>
              </div>
              <div className="mt-1 ml-7">
                <RankChips col={col} ranks={ranks.get(hit.id) ?? {}} />
              </div>
              <p className="mt-1 ml-7 line-clamp-2 text-xs text-slate-600">
                <Highlighted hit={hit} path="description" fallback={hit.description} />
              </p>
              <p className="mt-1 ml-7 text-xs text-slate-500">
                {hit.category} · {hit.brand} · ${hit.price.toFixed(2)}
              </p>
            </li>
          )
        })}
        {data && data.results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No results</li>}
      </ol>
      {data && <PipelinePanel col={col} pipeline={data.pipeline} onExplain={props.onExplain} />}
    </section>
  )
}

function PipelinePanel({ col, pipeline, onExplain }: { col: ColumnKey; pipeline: unknown[]; onExplain: () => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(pipeline, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <footer className="mt-auto border-t border-slate-100 text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${col}-pipeline`}
        onClick={() => setOpen((o) => !o)}
        className="text-mdb-forest flex w-full items-center gap-1 px-3 py-2 font-medium hover:bg-slate-50"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        {open ? 'Hide' : 'Show'} aggregation pipeline
      </button>
      {open && (
        <div id={`${col}-pipeline`} className="space-y-2 px-3 pb-3">
          {col === 'rerank' && (
            <p className="text-slate-500">Runs the hybrid pipeline below, then reranks the top results with Voyage rerank-3 in the API.</p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={onExplain} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50">
              Explain…
            </button>
            {col !== 'text' && <span className="ml-auto self-center text-slate-400">Copy includes the full query vector</span>}
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 leading-relaxed" data-testid={`${col}-pipeline-json`}>
            {JSON.stringify(abbreviate(pipeline), null, 2)}
          </pre>
        </div>
      )}
    </footer>
  )
}

export function SearchLab() {
  const [q, setQ] = useState('waterproof boots for rainy hikes')
  const [categories, setCategories] = useState<string[]>([])
  const [priceMax, setPriceMax] = useState<number | null>(null)
  const [weight, setWeight] = useState(0.5)
  const [request, setRequest] = useState<QueryRequest | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<ColumnKey | null>(null)

  const facets = useQuery({ queryKey: ['search-lab', 'facets'], queryFn: () => api.get<Facets>('/api/search-lab/facets') })
  const result = useQuery({
    queryKey: ['search-lab', 'query', request],
    queryFn: () => api.post<Response>(QUERY_URL, request),
    enabled: !!request,
    placeholderData: (prev) => prev,
  })
  const data = result.data
  const ranks = useMemo(() => rankIndex(data ?? {}), [data])
  const focused = pinned ?? hovered

  // Keep the pin only while the pinned product is still in the results.
  useEffect(() => {
    setPinned((p) => (p && ranks.has(p) ? p : null))
  }, [ranks])

  const build = (over: Partial<QueryRequest> = {}): QueryRequest => ({
    q: q.trim(),
    filters: { categories, price_min: null, price_max: priceMax },
    text_weight: weight,
    ...over,
  })
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (q.trim()) setRequest(build())
  }
  const commitWeight = () => request && setRequest({ ...request, text_weight: weight })
  const toggleCategory = (c: string) => {
    const next = categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]
    setCategories(next)
    if (request) setRequest(build({ filters: { categories: next, price_min: null, price_max: priceMax } }))
  }

  const drawerData = drawer ? data?.[drawer] : null

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex gap-2">
          <input
            aria-label="Search query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
            placeholder="Describe what you're looking for…"
          />
          <button type="submit" className="bg-mdb-forest rounded-md px-4 py-2 text-sm font-medium text-white">
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {facets.data?.categories.map((c) => (
            <button
              type="button"
              key={c}
              aria-pressed={categories.includes(c)}
              onClick={() => toggleCategory(c)}
              className={`rounded-full border px-3 py-0.5 ${categories.includes(c) ? 'border-mdb-forest bg-mdb-green/20' : 'border-slate-300'}`}
            >
              {c}
            </button>
          ))}
          <label className="ml-4 flex items-center gap-2">
            Max price
            <select
              value={priceMax ?? ''}
              onChange={(e) => setPriceMax(e.target.value ? Number(e.target.value) : null)}
              className="rounded border border-slate-300 px-2 py-0.5"
            >
              <option value="">Any</option>
              {[50, 100, 200, 400].map((p) => (
                <option key={p} value={p}>
                  ${p}
                </option>
              ))}
            </select>
          </label>
          <label className="ml-auto flex items-center gap-2">
            <span className="text-slate-600">Vector</span>
            <input
              type="range"
              aria-label="Text weight"
              min={0}
              max={1}
              step={0.1}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              onPointerUp={commitWeight}
              onKeyUp={commitWeight}
            />
            <span className="text-slate-600">Text</span>
            <span className="w-24 font-mono text-xs text-slate-500">
              {weight.toFixed(1)} / {(1 - weight).toFixed(1)}
            </span>
          </label>
        </div>
      </form>

      {request && (
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {COLUMN_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 font-semibold">
              <ModeDot color={COLUMNS[k].color} />
              {COLUMNS[k].title}
            </span>
          ))}
          <span className="text-slate-500">
            Hover a result to highlight it in every column · click to pin
            {pinned && (
              <>
                {' · '}
                <button type="button" onClick={() => setPinned(null)} className="text-mdb-forest underline">
                  clear pin
                </button>
              </>
            )}
          </span>
        </div>
      )}

      {request && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMN_KEYS.map((col) => (
            <ResultColumn
              key={col}
              col={col}
              data={data?.[col]}
              error={data?.errors[col]}
              disabledReason={col === 'rerank' ? data?.rerank_reason : null}
              loading={result.isFetching}
              ranks={ranks}
              focused={focused}
              pinned={pinned}
              onHover={setHovered}
              onPin={(id) => setPinned((p) => (p === id ? null : id))}
              onExplain={() => setDrawer(col)}
            />
          ))}
        </div>
      )}

      {drawer && drawerData && request && (
        <QueryDrawer
          key={`${drawer}-${JSON.stringify(request)}`}
          open
          onClose={() => setDrawer(null)}
          title={COLUMNS[drawer].title}
          pipeline={drawerData.pipeline}
          timings={drawerData.timings}
          fetchExplain={() => explainQuery(request, drawer)}
        />
      )}
    </div>
  )
}
