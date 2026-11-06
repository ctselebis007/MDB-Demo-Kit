import type { Schemas } from '../../core/api'

type ExploreResponse = Schemas['ExploreResponse']

export interface GNode {
  id: string
  type: string
  name: string
  description: string
  depth: number
  start: boolean
}

export interface GLink {
  source: string
  target: string
  type: string
}

export interface Graph {
  nodes: GNode[]
  links: GLink[]
}

export const linkKey = (l: GLink) => `${l.source}->${l.target}:${l.type}`

export function toGraph(resp: Pick<ExploreResponse, 'results' | 'links'>): Graph {
  return {
    nodes: resp.results.map(({ id, type, name, description, depth, start }) => ({ id, type, name, description, depth, start })),
    links: resp.links.map(({ source, target, type }) => ({ source, target, type })),
  }
}

/**
 * Merge an expansion into the current graph. Existing nodes keep their depth/start so the
 * colouring and layout stay stable; new nodes get depth relative to the expanded node.
 */
export function mergeGraph(current: Graph, next: Graph, fromId?: string): Graph {
  const byId = new Map(current.nodes.map((n) => [n.id, n]))
  const base = fromId ? (byId.get(fromId)?.depth ?? 0) : 0
  for (const n of next.nodes) {
    if (!byId.has(n.id)) byId.set(n.id, { ...n, start: false, depth: base + n.depth })
  }
  const links = new Map(current.links.map((l) => [linkKey(l), l]))
  for (const l of next.links) if (!links.has(linkKey(l))) links.set(linkKey(l), l)
  return { nodes: [...byId.values()], links: [...links.values()] }
}
