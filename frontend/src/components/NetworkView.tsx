import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ZoomIn, ZoomOut, Filter, Share2, Eye, Plus, Loader2, AlertCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchNetworkGraph, type NetworkNode, type NetworkEdge } from '../services/api';

// ── Simple Physics Simulation Types ──────
interface SimNode extends NetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function NetworkView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusId = (params.get('focus') || '').trim();
  const [data, setData] = useState<{ nodes: NetworkNode[]; edges: NetworkEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [showClaims, setShowClaims] = useState(true);
  const [showInsured, setShowInsured] = useState(true);
  const [showProviders, setShowProviders] = useState(true);

  // Search query
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Node Details
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);

  // Viewport transformation state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Simulation state
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<NetworkEdge[]>([]);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const draggingNodeRef = useRef<string | null>(null);

  // Cooling parameter to settle simulation (alpha temperature)
  const alphaRef = useRef(1.0);

  // Container refs for mouse events
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Fetch graph data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetchNetworkGraph();
        setData(res);

        // Initialize simulation positions (circle layout as initial state)
        const initialNodes: SimNode[] = res.nodes.map((node, i) => {
          const angle = (i / res.nodes.length) * 2 * Math.PI;
          const radius = 200 + Math.random() * 50;
          return {
            ...node,
            x: window.innerWidth / 2 + Math.cos(angle) * radius,
            y: window.innerHeight / 2 + Math.sin(angle) * radius,
            vx: 0,
            vy: 0,
          };
        });

        nodesRef.current = initialNodes;
        edgesRef.current = res.edges;
        setSimNodes(initialNodes);
      } catch (err: any) {
        setError(err.message || 'Error al cargar el grafo de red');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Focus node (from Entities -> Network deep link)
  useEffect(() => {
    if (!focusId) return;
    if (!containerRef.current) return;
    if (simNodes.length === 0) return;

    const node = simNodes.find((n) => n.id === focusId);
    if (!node) return;

    setSelectedNode(node);
    // Pan to node
    const width = containerRef.current?.clientWidth || window.innerWidth;
    const height = containerRef.current?.clientHeight || window.innerHeight;
    setZoom(1);
    setPan({
      x: width / 2 - node.x,
      y: height / 2 - node.y,
    });
    alphaRef.current = 1.0;
  }, [focusId, simNodes]);

  // Reheat simulation on filters or search change
  useEffect(() => {
    alphaRef.current = 1.0;
  }, [showClaims, showInsured, showProviders, searchQuery]);

  // 2. Physics Simulation Loop (Fruchterman-Reingold / Force Directed)
  useEffect(() => {
    if (loading || error || nodesRef.current.length === 0) return;

    let animId: number;
    const width = containerRef.current?.clientWidth || window.innerWidth;
    const height = containerRef.current?.clientHeight || window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    const tick = () => {
      // If the simulation has cooled down completely, skip physics to save CPU and stay stable
      if (alphaRef.current < 0.005) {
        animId = requestAnimationFrame(tick);
        return;
      }

      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const dragId = draggingNodeRef.current;

      // Force Constants
      // Tuned to keep clusters separated and avoid collapsing into a single point.
      const kRepulsion = 950; // Repelling force between all nodes
      const kAttraction = 0.03; // Pull force along edges (springs)
      const kGravity = 0.006; // Gentle gravity (avoid central collapse)
      const damping = 0.85; // Friction
      const minDist = 110; // Collision / separation radius

      // Calculate Repulsion Forces
      for (let i = 0; i < nodes.length; i++) {
        const u = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const v = nodes[j];
          const dx = u.x - v.x;
          const dy = u.y - v.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);

          // Base repulsion
          const rep = (kRepulsion / distSq) * alphaRef.current;
          const fx = (dx / dist) * rep;
          const fy = (dy / dist) * rep;
          u.vx += fx;
          u.vy += fy;
          v.vx -= fx;
          v.vy -= fy;

          // Extra collision push if too close
          if (dist < minDist) {
            const push = ((minDist - dist) / minDist) * 18 * alphaRef.current;
            const cfx = (dx / dist) * push;
            const cfy = (dy / dist) * push;
            u.vx += cfx;
            u.vy += cfy;
            v.vx -= cfx;
            v.vy -= cfy;
          }
        }
      }

      // Calculate Attraction Forces (along edges)
      edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);

        if (sourceNode && targetNode) {
          const dx = sourceNode.x - targetNode.x;
          const dy = sourceNode.y - targetNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

          // Ideal spring distance is around 130px
          const force = (dist - 130) * kAttraction * alphaRef.current;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          sourceNode.vx -= fx;
          sourceNode.vy -= fy;
          targetNode.vx += fx;
          targetNode.vy += fy;
        }
      });

      // Gravity force and Position Updates
      nodes.forEach((node) => {
        // Pull to center
        node.vx += (centerX - node.x) * kGravity * alphaRef.current;
        node.vy += (centerY - node.y) * kGravity * alphaRef.current;

        // Apply damping and update positions if not being dragged
        if (node.id !== dragId) {
          // Cap speed to avoid numerical collapse / oscillation
          const maxV = 40;
          node.vx = Math.max(-maxV, Math.min(maxV, node.vx));
          node.vy = Math.max(-maxV, Math.min(maxV, node.vy));

          node.x += node.vx;
          node.y += node.vy;
          node.vx *= damping;
          node.vy *= damping;
        } else {
          node.vx = 0;
          node.vy = 0;
        }
      });

      // Decay alpha temperature
      alphaRef.current *= 0.96;

      setSimNodes([...nodes]);
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [loading, error]);

  // 3. Filtered Nodes and Edges
  const filteredNodes = useMemo(() => {
    return simNodes.filter((node) => {
      // Type checks
      if (node.type === 'claim' && !showClaims) return false;
      if (node.type === 'insured' && !showInsured) return false;
      if (node.type === 'provider' && !showProviders) return false;

      // Search match
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesLabel = node.label.toLowerCase().includes(query);
        const matchesRamo = node.ramo?.toLowerCase().includes(query) || false;
        const matchesCob = node.cobertura?.toLowerCase().includes(query) || false;
        return matchesLabel || matchesRamo || matchesCob;
      }

      return true;
    });
  }, [simNodes, showClaims, showInsured, showProviders, searchQuery]);

  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
    return edgesRef.current.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [filteredNodes]);

  // High-Risk entities list (Top providers/insured with most red/yellow cases linked)
  const highRiskEntities = useMemo(() => {
    if (!data) return [];
    
    // Count how many warnings each provider/insured has
    const entityStats: Record<string, { node: NetworkNode; scoreSum: number; count: number }> = {};
    
    data.nodes.forEach((node) => {
      if (node.type === 'claim' && node.color === 'rojo') {
        // Find connected neighbors
        data.edges.forEach((edge) => {
          let neighbor: NetworkNode | undefined;
          if (edge.source === node.id) {
            neighbor = data.nodes.find((n) => n.id === edge.target);
          } else if (edge.target === node.id) {
            neighbor = data.nodes.find((n) => n.id === edge.source);
          }

          if (neighbor && neighbor.type !== 'claim') {
            if (!entityStats[neighbor.id]) {
              entityStats[neighbor.id] = { node: neighbor, scoreSum: 0, count: 0 };
            }
            entityStats[neighbor.id].scoreSum += node.score || 0;
            entityStats[neighbor.id].count += 1;
          }
        });
      }
    });

    return Object.values(entityStats)
      .map((stat) => ({
        ...stat.node,
        riskCount: stat.count,
        avgScore: Math.round(stat.scoreSum / (stat.count || 1)),
      }))
      .sort((a, b) => b.riskCount - a.riskCount);
  }, [data]);

  // 4. Mouse / Touch Pan and Drag Actions
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as SVGElement).tagName === 'svg') {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }

    const dragId = draggingNodeRef.current;
    if (dragId) {
      // Reheat simulation so elements adjust dynamically during drag
      alphaRef.current = 1.0;

      // Find drag node
      const node = nodesRef.current.find((n) => n.id === dragId);
      if (node) {
        // Convert mouse coordinates back to the simulated coordinate space accounting for pan/zoom
        const rect = containerRef.current?.getBoundingClientRect();
        const clientX = e.clientX - (rect?.left || 0);
        const clientY = e.clientY - (rect?.top || 0);

        node.x = (clientX - pan.x) / zoom;
        node.y = (clientY - pan.y) / zoom;
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    draggingNodeRef.current = null;
  };

  const handleNodeDragStart = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    draggingNodeRef.current = nodeId;
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 2));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.4));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] w-full gap-4 text-on-surface">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-body-lg font-medium">Analizando relaciones complejas en la base de datos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] w-full gap-4 text-center px-6">
        <AlertCircle className="text-error" size={56} />
        <h2 className="text-headline-md font-bold text-on-surface">Error al Cargar Red</h2>
        <p className="text-body-md text-on-surface-variant max-w-md">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-6 py-2.5 bg-primary text-on-primary rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity"
        >
          Reintentar Carga
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] -m-8 relative select-none">
      
      {/* ── Main Interactive Network Simulation canvas ──────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-surface-container-lowest overflow-hidden border-r border-outline-variant cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        
        {/* Grid Dotted Background Pattern */}
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #c4c7c7 1.5px, transparent 1.5px)',
            backgroundSize: `${30 * zoom}px ${30 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />

        {/* Floating Search Bar and Controls */}
        <div className="absolute top-6 left-6 z-20 flex flex-col gap-4 max-w-md w-full">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md p-1.5 flex items-center gap-2">
              <Search className="text-on-surface-variant ml-2 shrink-0" size={18} />
              <input
                type="text"
                placeholder="Buscar asegurados, talleres o ramos..."
                className="w-full bg-transparent border-none outline-none text-body-md text-on-surface placeholder:text-on-surface-variant/50 px-1 py-1"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Quick View Controls */}
            <div className="flex bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden p-1">
              <button
                onClick={zoomIn}
                className="p-2 hover:bg-surface-container-low text-on-surface transition-colors rounded-lg"
                title="Acercar"
              >
                <ZoomIn size={18} />
              </button>
              <button
                onClick={zoomOut}
                className="p-2 hover:bg-surface-container-low text-on-surface transition-colors rounded-lg"
                title="Alejar"
              >
                <ZoomOut size={18} />
              </button>
              <button
                onClick={resetView}
                className="p-2 hover:bg-surface-container-low text-on-surface transition-colors rounded-lg font-mono text-[11px] font-bold"
                title="Restaurar vista"
              >
                1:1
              </button>
            </div>
          </div>

          {/* Quick Stats Widget */}
          <div className="bg-surface-container-lowest border border-outline-variant px-4 py-2.5 rounded-xl shadow-md flex items-center gap-2 w-fit">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-ping"></span>
            <span className="text-label-sm font-bold text-on-surface">
              {filteredNodes.filter((n) => n.type === 'claim').length} siniestros sospechosos identificados en la red
            </span>
          </div>
        </div>

        {/* Dynamic Nodes Container */}
        <div
          className="absolute inset-0 origin-top-left pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG Container for Dynamic Connected Edges */}
          <svg className="absolute inset-0 w-[5000px] h-[5000px] overflow-visible pointer-events-none" style={{ left: -2500, top: -2500 }}>
            <g transform="translate(2500, 2500)">
              {filteredEdges.map((edge) => {
                const sourceNode = filteredNodes.find((n) => n.id === edge.source);
                const targetNode = filteredNodes.find((n) => n.id === edge.target);

                if (!sourceNode || !targetNode) return null;

                const isHighRisk =
                  (sourceNode.type === 'claim' && sourceNode.color === 'rojo') ||
                  (targetNode.type === 'claim' && targetNode.color === 'rojo');

                return (
                  <line
                    key={edge.id}
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke={isHighRisk ? '#ba1a1a' : '#c4c7c7'}
                    strokeWidth={isHighRisk ? 2.5 : 1.5}
                    strokeDasharray={isHighRisk ? 'none' : '4 4'}
                    className="transition-all"
                  />
                );
              })}
            </g>
          </svg>

          {/* Render Interactive Nodes */}
          {filteredNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            
            // Icon mapping
            let nodeIcon = 'person';
            let bgClass = 'bg-surface-container-lowest border-outline-variant text-on-surface-variant';
            
            if (node.type === 'claim') {
              nodeIcon = 'description';
              bgClass =
                node.color === 'rojo'
                  ? 'border-error text-error bg-error-container/20 border-2'
                  : 'border-warning text-warning bg-warning-container/20 border-2';
            } else if (node.type === 'provider') {
              nodeIcon = 'build';
              bgClass = 'border-primary text-primary bg-primary-container/10 border-2';
            }

            return (
              <div
                key={node.id}
                className={`absolute pointer-events-auto flex flex-col items-center justify-center group cursor-grab active:cursor-grabbing transition-shadow ${
                  isSelected ? 'z-50' : 'z-10'
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => handleNodeDragStart(node.id, e)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNode(node);
                }}
                onDoubleClick={() => {
                  if (node.type === 'claim') {
                    const cleanId = node.id.replace('claim_', '');
                    navigate(`/analyzer?id=${cleanId}`);
                  }
                }}
              >
                {/* Node Circle Shape */}
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${bgClass} ${
                    isSelected ? 'ring-4 ring-primary/40 scale-110 shadow-lg' : 'hover:scale-105'
                  } transition-all`}
                >
                  <span className="material-symbols-outlined text-[24px]">{nodeIcon}</span>
                </div>

                {/* Node text details badge */}
                <div className="absolute top-14 bg-surface-container-lowest/90 border border-outline-variant/80 px-2 py-0.5 rounded-lg shadow-sm whitespace-nowrap opacity-90 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-bold text-on-surface">
                    {node.label}
                  </span>
                </div>

                {/* Micro badge indicator for critical claims */}
                {node.type === 'claim' && node.score && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-error text-on-error rounded-full flex items-center justify-center text-[9px] font-bold border border-surface-container-lowest shadow-sm">
                    {node.score}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Dynamic Legend and Filter Bottom Left */}
        <div className="absolute bottom-6 left-6 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-lg z-20 w-64">
          <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-4">
            Visualización de Filtros
          </h4>
          <div className="space-y-3.5">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="form-checkbox w-4.5 h-4.5 text-primary border-outline-variant rounded focus:ring-primary"
                checked={showClaims}
                onChange={(e) => setShowClaims(e.target.checked)}
              />
              <div className="w-3.5 h-3.5 rounded-sm bg-error/20 border border-error shrink-0" />
              <span className="text-label-md text-on-surface font-medium">Siniestros Sospechosos</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="form-checkbox w-4.5 h-4.5 text-primary border-outline-variant rounded focus:ring-primary"
                checked={showInsured}
                onChange={(e) => setShowInsured(e.target.checked)}
              />
              <div className="w-3.5 h-3.5 rounded-sm bg-surface-container-high border border-outline shrink-0" />
              <span className="text-label-md text-on-surface font-medium">Asegurados</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="form-checkbox w-4.5 h-4.5 text-primary border-outline-variant rounded focus:ring-primary"
                checked={showProviders}
                onChange={(e) => setShowProviders(e.target.checked)}
              />
              <div className="w-3.5 h-3.5 rounded-sm bg-primary/20 border border-primary shrink-0" />
              <span className="text-label-md text-on-surface font-medium">Proveedores (Talleres/Clínicas)</span>
            </label>
          </div>
        </div>

      </div>

      {/* ── Dynamic Right Sidebar: High Risk Details & Selection ──────────────── */}
      <div className="w-[360px] bg-surface-container-lowest shrink-0 flex flex-col h-full border-l border-outline-variant z-20">
        
        {/* Selected entity details panel */}
        {selectedNode ? (
          <div className="flex-1 flex flex-col h-full">
            <div className="p-6 border-b border-outline-variant">
              <div className="flex justify-between items-start mb-4">
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-label-sm font-bold text-primary hover:underline cursor-pointer"
                >
                  ← Ver Todos los Riesgos
                </button>
                {selectedNode.type === 'claim' && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    selectedNode.color === 'rojo' ? 'bg-error-container text-error' : 'bg-warning-container text-warning'
                  }`}>
                    SCORE {selectedNode.score}/100
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[22px]">
                    {selectedNode.type === 'claim' ? 'description' : selectedNode.type === 'provider' ? 'build' : 'person'}
                  </span>
                </div>
                <div>
                  <h3 className="text-headline-sm font-bold text-on-surface leading-tight">
                    {selectedNode.label}
                  </h3>
                  <p className="text-label-sm text-on-surface-variant capitalize">
                    Entidad de tipo {selectedNode.type === 'claim' ? 'siniestro' : selectedNode.type === 'provider' ? 'proveedor' : 'asegurado'}
                  </p>
                </div>
              </div>
            </div>

            {/* Entity metadata view body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
              {selectedNode.type === 'claim' ? (
                <>
                  <div className="space-y-4">
                    <h4 className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider">Detalles del Reclamo</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface-container-low p-3 rounded-lg">
                        <span className="text-[10px] text-on-surface-variant/70 uppercase">Ramo</span>
                        <p className="text-label-md font-bold text-on-surface">{selectedNode.ramo}</p>
                      </div>
                      <div className="bg-surface-container-low p-3 rounded-lg">
                        <span className="text-[10px] text-on-surface-variant/70 uppercase">Cobertura</span>
                        <p className="text-label-md font-bold text-on-surface">{selectedNode.cobertura}</p>
                      </div>
                      <div className="bg-surface-container-low p-3 rounded-lg col-span-2">
                        <span className="text-[10px] text-on-surface-variant/70 uppercase">Monto Reclamado</span>
                        <p className="text-label-lg font-bold text-on-surface">
                          ${selectedNode.monto?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-outline-variant">
                    <button
                      onClick={() => {
                        const cleanId = selectedNode.id.replace('claim_', '');
                        navigate(`/analyzer?id=${cleanId}`);
                      }}
                      className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl flex items-center justify-center gap-2 shadow hover:opacity-90 transition-opacity"
                    >
                      <Eye size={18} /> Abrir en ClaimAnalyzer
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <h4 className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider">Enlaces Directos</h4>
                  <p className="text-body-md text-on-surface-variant leading-relaxed">
                    Esta entidad se encuentra conectada con múltiples siniestros clasificados como sospechosos de fraude.
                  </p>
                  <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                    <span className="text-[10px] text-on-surface-variant/70 uppercase font-bold">Casos Vinculados</span>
                    <ul className="mt-2 space-y-2">
                      {edgesRef.current
                        .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
                        .map((edge) => {
                          const claimId = edge.source.includes('claim') ? edge.source : edge.target;
                          const cleanId = claimId.replace('claim_', '');
                          return (
                            <li key={edge.id} className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant p-2 rounded-lg">
                              <span className="text-label-md font-medium text-on-surface">Siniestro #{cleanId}</span>
                              <button
                                onClick={() => navigate(`/analyzer?id=${cleanId}`)}
                                className="text-xs text-primary font-bold hover:underline"
                              >
                                Analizar
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Header default */}
            <div className="p-6 pb-2">
              <h3 className="text-headline-sm font-bold text-on-surface mb-1">
                Entidades de Alto Riesgo
              </h3>
              <p className="text-body-sm text-on-surface-variant">
                Relación de talleres, clínicas y asegurados con mayor concurrencia de alertas.
              </p>
            </div>

            {/* List of high risk nodes */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-4 no-scrollbar">
              {highRiskEntities.slice(0, 15).map((entity) => {
                let bgCircle = 'bg-primary-container/10 border-primary text-primary';
                let iconName = 'build';

                if (entity.type === 'insured') {
                  bgCircle = 'bg-surface-container-high border-outline text-on-surface-variant';
                  iconName = 'person';
                }

                return (
                  <div
                    key={entity.id}
                    onClick={() => {
                      const simNode = nodesRef.current.find((n) => n.id === entity.id);
                      if (simNode) {
                        setSelectedNode(simNode);
                        // Pan to entity
                        const width = containerRef.current?.clientWidth || window.innerWidth;
                        const height = containerRef.current?.clientHeight || window.innerHeight;
                        setPan({
                          x: width / 2 - simNode.x * zoom,
                          y: height / 2 - simNode.y * zoom,
                        });
                      }
                    }}
                    className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer group flex gap-3 items-center"
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border-2 ${bgCircle}`}>
                      <span className="material-symbols-outlined text-[20px]">{iconName}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-label-md font-bold text-on-surface truncate group-hover:text-primary transition-colors">
                        {entity.label}
                      </h4>
                      <p className="text-[11px] text-on-surface-variant">
                        {entity.riskCount} siniestro{(entity.riskCount || 0) > 1 ? 's' : ''} rojo{(entity.riskCount || 0) > 1 ? 's' : ''} vinculado{(entity.riskCount || 0) > 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end">
                      <span className="bg-error-container text-error px-2 py-0.5 rounded text-[10px] font-bold">
                        {entity.avgScore}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-6 pt-2">
              <button
                className="w-full py-3 flex items-center justify-center gap-2 border-2 border-dashed border-outline-variant rounded-xl text-on-surface-variant font-label-md font-bold hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
                onClick={() => {
                  setSelectedNode(null);
                  resetView();
                }}
              >
                <Plus size={18} /> Restaurar Red Completa
              </button>
            </div>
          </>
        )}

      </div>

    </div>
  );
}
