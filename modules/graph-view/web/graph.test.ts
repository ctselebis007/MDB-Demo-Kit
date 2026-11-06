import { describe, expect, it } from 'vitest'
import { mergeGraph, toGraph } from './graph'

const node = (id: string, depth: number, start = false) => ({
  id,
  type: 'part',
  name: id,
  description: '',
  depth,
  start,
  score: null,
})

describe('toGraph', () => {
  it('maps API results and links to D3 nodes/links', () => {
    const g = toGraph({
      results: [node('a', 0, true), node('b', 1)],
      links: [{ source: 'a', target: 'b', type: 'supplies' }],
    })
    expect(g.nodes.map((n) => [n.id, n.depth, n.start])).toEqual([
      ['a', 0, true],
      ['b', 1, false],
    ])
    expect(g.links).toEqual([{ source: 'a', target: 'b', type: 'supplies' }])
    expect(g.nodes[0]).not.toHaveProperty('score')
  })
})

describe('mergeGraph', () => {
  it('de-duplicates nodes and links and keeps existing depth', () => {
    const current = toGraph({
      results: [node('a', 0, true), node('b', 1)],
      links: [{ source: 'a', target: 'b', type: 'supplies' }],
    })
    const expansion = toGraph({
      results: [node('b', 0, true), node('a', 1), node('c', 1)],
      links: [
        { source: 'a', target: 'b', type: 'supplies' },
        { source: 'b', target: 'c', type: 'component_of' },
      ],
    })
    const merged = mergeGraph(current, expansion, 'b')
    expect(merged.nodes.map((n) => [n.id, n.depth, n.start])).toEqual([
      ['a', 0, true],
      ['b', 1, false],
      ['c', 2, false],
    ])
    expect(merged.links).toHaveLength(2)
  })
})
