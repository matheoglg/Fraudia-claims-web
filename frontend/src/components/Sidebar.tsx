import { NavLink } from 'react-router-dom';
import { Menu, ChevronLeft } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  return (
    <aside 
      className={`bg-surface-container-lowest border-r border-outline-variant flex flex-col h-screen fixed left-0 top-0 transition-all duration-300 z-30 ${isOpen ? 'w-[240px]' : 'w-[80px]'}`}
    >
      <div className={`p-4 flex items-center mb-2 ${isOpen ? 'justify-between' : 'justify-center'} mt-2`}>
        {isOpen && (
          <h1 className="text-title-lg font-bold text-on-surface flex items-center gap-2">
            Fraudia Claims
          </h1>
        )}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface-variant flex-shrink-0"
        >
          {isOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto mt-2">
        <NavLink 
          to="/" 
          title="Claims"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="dashboard">dashboard</span>
          {isOpen && <span>Dashboard</span>}
        </NavLink>
        
        <NavLink 
          to="/analyzer" 
          title="Analizador de Siniestros"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="analytics">analytics</span>
          {isOpen && <span>Analizador</span>}
        </NavLink>
        
        <NavLink 
          to="/agent" 
          title="Agente"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="psychiatry">psychiatry</span>
          {isOpen && <span>Agente</span>}
        </NavLink>
        
        <NavLink 
          to="/network" 
          title="Red de Relaciones"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="hub">hub</span>
          {isOpen && <span>Red de Relaciones</span>}
        </NavLink>

        <NavLink 
          to="/entities" 
          title="Entities"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="recent_patient">recent_patient</span>
          {isOpen && <span>Entities</span>}
        </NavLink>

        <NavLink 
          to="/reports" 
          title="Reports"
          className={({ isActive }) => `flex items-center gap-3 py-2.5 rounded-lg transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'} ${isActive ? 'text-primary font-bold bg-surface-container-high' : 'text-on-secondary-fixed-variant hover:bg-surface-container-high'}`}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="bar_chart">bar_chart</span>
          {isOpen && <span>Reports</span>}
        </NavLink>
      </nav>

      <div className="mt-auto px-3 pb-4 space-y-1">
        <a 
          className={`flex items-center gap-3 py-2 rounded-lg text-on-secondary-fixed-variant hover:bg-surface-container-high transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'}`} 
          href="#"
          title="A implementar próximamente"
          onClick={(e) => e.preventDefault()}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="settings">settings</span>
          {isOpen && <span>Settings</span>}
        </a>
        <a 
          className={`flex items-center gap-3 py-2 rounded-lg text-on-secondary-fixed-variant hover:bg-surface-container-high transition-colors font-label-md ${isOpen ? 'px-3' : 'justify-center'}`} 
          href="#"
          title="A implementar próximamente"
          onClick={(e) => e.preventDefault()}
        >
          <span className="material-symbols-outlined text-[20px]" data-icon="help">help</span>
          {isOpen && <span>Help</span>}
        </a>
      </div>
    </aside>
  );
}
