import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { searchGlobal, type SearchResponse } from '../services/api';

interface TopBarProps {
  isSidebarOpen: boolean;
}

export default function TopBar({ isSidebarOpen }: TopBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      // Reset to full dashboard when Enter is pressed with empty input
      setResults(null);
      setOpen(false);
      navigate('/', { replace: true });
      return;
    }
    setLoading(true);
    try {
      const res = await searchGlobal(q);
      setResults(res);
      setOpen(true);
    } catch {
      // Fallback: at least route to dashboard filter
      navigate(`/?q=${encodeURIComponent(q)}`);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header 
      className={`fixed top-0 right-0 h-16 bg-surface border-b border-outline-variant flex justify-between items-center px-gutter z-20 transition-all duration-300 ${isSidebarOpen ? 'left-[240px]' : 'left-[80px]'}`}
    >
      <div className="flex items-center gap-8">
        <div className="relative" ref={containerRef}>
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]" data-icon="search">search</span>
          <input
            className="bg-surface-container-low border border-outline-variant rounded-lg pl-10 pr-10 py-1.5 w-80 text-body-md focus:border-primary focus:ring-0 transition-all"
            placeholder="Buscar siniestro, entidad o póliza..."
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[12px]">
              …
            </span>
          )}

          {open && results && (
            <div className="absolute top-12 left-0 w-[520px] bg-surface border border-outline-variant rounded-xl shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
                <div className="text-label-sm font-bold text-on-surface">Resultados para “{results.query}”</div>
                <button
                  className="text-[11px] font-bold text-primary hover:underline"
                  onClick={() => {
                    navigate(`/?q=${encodeURIComponent(results.query)}`);
                    setOpen(false);
                  }}
                >
                  Ver en siniestros
                </button>
              </div>

              <div className="max-h-[360px] overflow-y-auto">
                <Section
                  title="Siniestros"
                  empty="No hay siniestros"
                  items={results.claims.map((c) => ({
                    key: `c_${c.id_siniestro}`,
                    primary: `Siniestro #${c.id_siniestro}`,
                    secondary: `${c.ramo ?? '—'} · ${c.cobertura ?? '—'} · ${c.asegurado_nombre ?? c.id_asegurado}`,
                    onClick: () => {
                      navigate(`/analyzer?id=${encodeURIComponent(String(c.id_siniestro))}`);
                      setOpen(false);
                    },
                  }))}
                />

                <Section
                  title="Entidades (Proveedores)"
                  empty="No hay entidades"
                  items={results.providers.map((p) => ({
                    key: `p_${p.id_proveedor}`,
                    primary: p.nombre,
                    secondary: `${p.id_proveedor}${p.tipo_proveedor ? ` · ${p.tipo_proveedor}` : ''}`,
                    onClick: () => {
                      navigate(`/entities?q=${encodeURIComponent(p.nombre)}`);
                      setOpen(false);
                    },
                  }))}
                />

                <Section
                  title="Pólizas"
                  empty="No hay pólizas"
                  items={results.policies.map((p) => ({
                    key: `pol_${p.id_poliza}`,
                    primary: p.id_poliza,
                    secondary: `Asegurado ${p.id_asegurado}`,
                    onClick: () => {
                      navigate(`/?q=${encodeURIComponent(p.id_poliza)}`);
                      setOpen(false);
                    },
                  }))}
                />
              </div>
            </div>
          )}
        </div>
        <nav className="hidden md:flex gap-6">
          <NavLink to="/" className={({ isActive }) => `font-label-md py-5 transition-opacity ${isActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'}`}>
            Dashboard & Claims
          </NavLink>
          <NavLink to="/entities" className={({ isActive }) => `font-label-md py-5 transition-opacity ${isActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'}`}>
            Entities
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `font-label-md py-5 transition-opacity ${isActive ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-primary'}`}>
            Reports
          </NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
          <span className="material-symbols-outlined" data-icon="notifications">notifications</span>
        </button>
        <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
          <span className="material-symbols-outlined" data-icon="more_vert">more_vert</span>
        </button>
        <div className="h-8 w-8 rounded-full overflow-hidden bg-surface-container-highest border border-outline-variant">
          <img alt="Investigator Avatar" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAgJbOMgvqFxEXUWaxqfd3vMgVqVI__VidWmC8rq2pK2xo6LWe73KTarQxicezk0EHi-uGLX7CKubnqMw-SKz3Odu9y4smWhoKXrvt7MY8hwFsZykwNu63gHmFjF5pDL09GWQsBDlkRWfm8q3m7LsOUL5yVUruaPQQYYh0Fz7_GVYmRMNuvCKMHHWNp3qARplp_cywdC1mUbYPFlWorR-dJPyCOGSU3cLX1dawAFfZjq4PI2qLAHLJNokq2L7XUmTp-8OW28QQXcNg" />
        </div>
      </div>
    </header>
  );
}

function Section({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; primary: string; secondary: string; onClick: () => void }[];
}) {
  return (
    <div className="px-2 py-2">
      <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="px-2 pb-2 text-[11px] text-on-surface-variant">{empty}</div>
      ) : (
        <div className="space-y-1 pb-2">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-container-low transition-colors"
            >
              <div className="text-label-md font-bold text-on-surface">{it.primary}</div>
              <div className="text-[11px] text-on-surface-variant truncate">{it.secondary}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
