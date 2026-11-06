import { describe, expect, it } from 'vitest'
import { otherRanks, rankIndex } from './crossHighlight'

const col = (...ids: string[]) => ({ results: ids.map((id, i) => ({ id, rank: i + 1 })) })

describe('rankIndex', () => {
  it('maps product ids across columns', () => {
    const index = rankIndex({ text: col('a', 'b'), vector: col('b', 'c'), hybrid: col('c', 'a', 'b'), rerank: null })
    expect(index.get('a')).toEqual({ text: 1, hybrid: 2 })
    expect(index.get('b')).toEqual({ text: 2, vector: 1, hybrid: 3 })
    expect(index.get('c')).toEqual({ vector: 2, hybrid: 1 })
  })

  it('lists ranks in the other columns only', () => {
    const index = rankIndex({ text: col('a'), vector: col('x', 'a'), rerank: col('a') })
    expect(otherRanks(index, 'a', 'text')).toEqual([
      ['vector', 2],
      ['rerank', 1],
    ])
    expect(otherRanks(index, 'missing', 'text')).toEqual([])
  })
})
