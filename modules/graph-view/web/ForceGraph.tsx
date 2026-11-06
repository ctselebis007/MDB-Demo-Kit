import * as d3 from 'd3'
import { useEffect, useRef } from 'react'
import { linkKey, type GLink, type GNode } from './graph'

type SimNode = GNode & d3.SimulationNodeDatum
type SimLink = d3.SimulationLinkDatum<SimNode> & { type: string; key: string }

export const DEPTH_COLORS = ['#00684a', '#00ed64', '#016bf8', '#b45af2', '#ffc010', '#ef5752']
export const TYPE_SYMBOLS: Record<string, d3.SymbolType> = {
  supplier: d3.symbolCircle,
  part: d3.symbolSquare,
  product: d3.symbolDiamond,
  customer: d3.symbolTriangle,
}
const LINK_COLORS: Record<string, string> = { supplies: '#94a3b8', component_of: '#64748b', sold_to: '#cbd5e1' }

interface Props {
  nodes: GNode[]
  links: GLink[]
  onNodeClick: (id: string) => void
  width?: number
  height?: number
}

export function ForceGraph({ nodes, links, onNodeClick, width = 1100, height = 640 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const positions = useRef(new Map<string, SimNode>())
  const clickRef = useRef(onNodeClick)
  useEffect(() => {
    clickRef.current = onNodeClick
  }, [onNodeClick])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    const viewport = svg.append('g').attr('class', 'viewport')
    viewport.append('g').attr('class', 'links')
    viewport.append('g').attr('class', 'nodes')
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (e) => viewport.attr('transform', e.transform.toString())),
    )
    simRef.current = d3
      .forceSimulation<SimNode, SimLink>()
      .force('charge', d3.forceManyBody().strength(-160))
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>()
          .id((d) => d.id)
          .distance(55),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(16))
    return () => {
      simRef.current?.stop()
      svg.selectAll('*').remove()
      svg.on('.zoom', null)
    }
  }, [width, height])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const prev = positions.current
    const hadNodes = prev.size > 0
    const neighbour = new Map<string, string>()
    for (const l of links) {
      if (prev.has(l.source)) neighbour.set(l.target, l.source)
      if (prev.has(l.target)) neighbour.set(l.source, l.target)
    }
    const simNodes: SimNode[] = nodes.map((n) => {
      const old = prev.get(n.id)
      if (old) return Object.assign(old, n)
      const anchor = prev.get(neighbour.get(n.id) ?? '')
      const jitter = () => (Math.random() - 0.5) * 40
      return { ...n, x: (anchor?.x ?? width / 2) + jitter(), y: (anchor?.y ?? height / 2) + jitter() }
    })
    positions.current = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = links.map((l) => ({ ...l, key: linkKey(l) }))

    const svg = d3.select(svgRef.current!)
    const link = svg
      .select<SVGGElement>('g.links')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, (d) => d.key)
      .join('line')
      .attr('stroke', (d) => LINK_COLORS[d.type] ?? '#cbd5e1')
      .attr('stroke-width', 1.2)

    const node = svg
      .select<SVGGElement>('g.nodes')
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'node').style('cursor', 'pointer')
        g.append('path')
        g.append('text').attr('x', 10).attr('y', 4).attr('font-size', 10).attr('fill', '#334155')
        g.append('title')
        return g
      })
    node
      .select('path')
      .attr('d', (d) => d3.symbol(TYPE_SYMBOLS[d.type] ?? d3.symbolCircle, d.start ? 260 : 120)())
      .attr('fill', (d) => DEPTH_COLORS[Math.min(d.depth, DEPTH_COLORS.length - 1)])
      .attr('stroke', (d) => (d.start ? '#001e2b' : '#fff'))
      .attr('stroke-width', 1.5)
    node.select('text').text((d) => d.name)
    node.select('title').text((d) => `${d.name} (${d.type}, depth ${d.depth})\n${d.description}\nClick to expand`)
    node.on('click', (_e, d) => clickRef.current(d.id))
    node.call(
      d3
        .drag<SVGGElement, SimNode>()
        .on('start', (e, d) => {
          if (!e.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (e, d) => {
          d.fx = e.x
          d.fy = e.y
        })
        .on('end', (e, d) => {
          if (!e.active) sim.alphaTarget(0)
          d.fx = null
          d.fy = null
        }),
    )

    sim.nodes(simNodes)
    sim.force<d3.ForceLink<SimNode, SimLink>>('link')!.links(simLinks)
    sim.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })
    sim.alpha(hadNodes ? 0.3 : 1).restart()
  }, [nodes, links, width, height])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-[640px] w-full rounded-lg border border-slate-200 bg-white"
      role="img"
      aria-label="Supply chain graph"
    />
  )
}
