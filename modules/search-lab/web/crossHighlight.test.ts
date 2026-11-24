import { describe, expect, it } from 'vitest'
import { rankIndex } from './crossHighlight'

const col = (...ids: string[]) => ({ results: ids.map((id, i) => ({ id, rank: i + 1 })) })

describe('rankIndex', () => {
  it('maps product ids across columns', () => {
    const index = rankIndex({ text: col('a', 'b'), vector: col('b', 'c'), hybrid: col('c', 'a', 'b'), rerank: null })
    expect(index.get('a')).toEqual({ text: 1, hybrid: 2 })
    expect(index.get('b')).toEqual({ text: 2, vector: 1, hybrid: 3 })
    expect(index.get('c')).toEqual({ vector: 2, hybrid: 1 })
  })
})
