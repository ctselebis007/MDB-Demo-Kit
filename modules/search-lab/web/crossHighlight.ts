export type ColumnKey = 'text' | 'vector' | 'hybrid' | 'rerank'

export const COLUMN_KEYS: ColumnKey[] = ['text', 'vector', 'hybrid', 'rerank']

interface Ranked {
  results: { id: string; rank: number }[]
}

export type RankIndex = Map<string, Partial<Record<ColumnKey, number>>>

/** product id -> rank in each column, used to cross-highlight a hovered result. */
export function rankIndex(columns: Partial<Record<ColumnKey, Ranked | null | undefined>>): RankIndex {
  const index: RankIndex = new Map()
  for (const key of COLUMN_KEYS) {
    for (const hit of columns[key]?.results ?? []) {
      index.set(hit.id, { ...index.get(hit.id), [key]: hit.rank })
    }
  }
  return index
}

/** Ranks of `id` in columns other than `self`, e.g. [['vector', 3], ['hybrid', 1]]. */
export function otherRanks(index: RankIndex, id: string, self: ColumnKey): [ColumnKey, number][] {
  const ranks = index.get(id) ?? {}
  return COLUMN_KEYS.filter((k) => k !== self && ranks[k] != null).map((k) => [k, ranks[k]!])
}
