import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, FileText, TrendingUp, Paperclip, ArrowUp, User, Sparkles, TriangleAlert, Clock, Plus, Trash2, X, Download } from 'lucide-react';
import { chatWithAgent, exportAgentPdf } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
  loading?: boolean;
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ── localStorage persistence ──────────────────────────────────────────────────

const STORAGE_KEY = 'fraudia_agent_sessions';

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-surface-container-highest px-1 rounded text-sm font-mono">$1</code>')
    .replace(/\n/g, '<br/>');
}

// ── Suggestion Card ───────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: Search, text: '¿Qué proveedores concentran más alertas de fraude?' },
  { icon: FileText, text: 'Genera un resumen de los 10 siniestros más críticos.' },
  { icon: TrendingUp, text: 'Analiza patrones de fraude en el ramo Vehículos.' },
];

// ── Loading Dots ──────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// ── Helper: extract a short title from the first user message ─────────────────
function extractTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Nueva conversación';
  const text = first.text.trim();
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

// ── Format relative time ──────────────────────────────────────────────────────
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Justo ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days}d`;
}

// ── AgentView ─────────────────────────────────────────────────────────────────
export default function AgentView() {
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [nextId, setNextId] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Active session's messages
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];

  // Persist sessions to localStorage whenever they change
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Create a new session
  const createNewSession = useCallback(() => {
    const newSession: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: 'Nueva conversación',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setNextId(1);
    setIsHistoryOpen(false);
  }, []);

  // Update messages in the active session
  const updateActiveMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const newMsgs = updater(s.messages);
          return {
            ...s,
            messages: newMsgs,
            title: extractTitle(newMsgs),
            updatedAt: Date.now(),
          };
        })
      );
    },
    [activeSessionId]
  );

  // Delete a session
  const deleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }
  };

  const sendMessage = async (question: string) => {
    const text = question.trim();
    if (!text || isThinking) return;

    // If no active session, create one first
    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      const newSession: Session = {
        id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: text.length > 60 ? text.slice(0, 57) + '…' : text,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      targetSessionId = newSession.id;
    }

    const userMsg: Message = { id: nextId, role: 'user', text };

    // Update messages in the target session
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== targetSessionId) return s;
        const newMsgs = [...s.messages, userMsg];
        return { ...s, messages: newMsgs, title: extractTitle(newMsgs), updatedAt: Date.now() };
      })
    );

    setNextId((n) => n + 1);
    setInput('');
    setIsThinking(true);

    try {
      const res = await chatWithAgent(text);
      const agentMsg: Message = { id: nextId + 1, role: 'agent', text: res.answer };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSessionId) return s;
          return { ...s, messages: [...s.messages, agentMsg], updatedAt: Date.now() };
        })
      );
      setNextId((n) => n + 2);
    } catch (e: any) {
      const errMsg: Message = {
        id: nextId + 1,
        role: 'agent',
        text: `⚠️ No se pudo conectar con el agente: ${e.message}\n\nVerifica que el backend esté corriendo en el puerto 5000.`,
      };
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSessionId) return s;
          return { ...s, messages: [...s.messages, errMsg], updatedAt: Date.now() };
        })
      );
      setNextId((n) => n + 2);
    } finally {
      setIsThinking(false);
    }
  };

  const exportPdf = async () => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session || session.messages.length === 0) {
      alert('No hay mensajes para exportar.');
      return;
    }
    try {
      const blob = await exportAgentPdf({
        title: `Auditoría – ${session.title}`,
        messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria_agente_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`No se pudo exportar PDF: ${e.message ?? e}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  const showWelcome = messages.length === 0;

  return (
    <div className="flex-1 flex flex-col items-center h-[calc(100vh-128px)] overflow-y-auto no-scrollbar pb-40">
      <div className="w-full max-w-4xl px-4 flex flex-col mt-12 gap-8">

        {/* Welcome Header */}
        {showWelcome && (
          <>
            <div className="text-center space-y-4 mb-4">
              <div className="w-12 h-12 bg-primary rounded-xl mx-auto flex items-center justify-center shadow-md">
                <span className="material-symbols-outlined text-on-primary text-[24px]">psychiatry</span>
              </div>
              <h1 className="text-display font-display font-bold text-on-surface">Agente de Fraude</h1>
              <p className="text-body-lg text-on-surface-variant">
                Haz preguntas sobre siniestros, proveedores o patrones en el dataset.
              </p>
            </div>

            {/* Suggestion Cards */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              {SUGGESTIONS.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  className="bg-surface-container-lowest border border-outline-variant p-5 rounded-xl hover:bg-surface-container-low transition-colors text-left flex flex-col gap-4 shadow-sm"
                  onClick={() => handleSuggestion(text)}
                >
                  <Icon className="text-on-surface-variant" size={20} />
                  <span className="text-body-md text-on-surface font-medium leading-relaxed">{text}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Chat History */}
        <div className="flex flex-col gap-8">
          {messages.map((msg) => (
            <div key={msg.id} className="flex gap-4 items-start">
              {/* Avatar */}
              {msg.role === 'user' ? (
                <div className="w-10 h-10 rounded bg-surface-container-high flex items-center justify-center shrink-0 border border-outline-variant">
                  <User size={20} className="text-on-surface-variant" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded bg-primary flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles size={20} className="text-on-primary" />
                </div>
              )}

              {/* Message Body */}
              <div className="flex-1 pt-2">
                {msg.role === 'user' ? (
                  <p className="text-body-lg text-on-surface">{msg.text}</p>
                ) : (
                  <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm space-y-3">
                    <div
                      className="text-body-md text-on-surface leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                    />
                    {msg.text.includes('⚠️') && (
                      <div className="flex items-center gap-2 text-label-sm text-on-surface-variant border-t border-outline-variant pt-3 mt-2">
                        <TriangleAlert size={14} />
                        Verifica siempre la información clave con las fuentes directas.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded bg-primary flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                <Sparkles size={20} className="text-on-primary" />
              </div>
              <div className="flex-1 pt-2">
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm inline-block">
                  <ThinkingDots />
                </div>
              </div>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Sticky Input Area */}
      <div className="fixed bottom-0 left-[240px] right-0 p-8 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest to-transparent flex flex-col items-center pointer-events-none">
        <div className="w-full max-w-4xl pointer-events-auto">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-lg p-4 mb-2 focus-within:border-primary transition-colors focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent border-none outline-none resize-none text-body-lg text-on-surface placeholder:text-on-surface-variant/50 min-h-[48px]"
              placeholder="Haz una pregunta sobre siniestros, proveedores o patrones…"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
            />
            <div className="flex justify-between items-center mt-2">
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant transition-colors text-label-md font-medium"
                  onClick={createNewSession}
                  title="Nueva conversación"
                >
                  <Plus size={16} /> Nueva sesión
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant transition-colors text-label-md font-medium"
                  onClick={() => setIsHistoryOpen(true)}
                  title="Historial de sesiones"
                >
                  <Clock size={16} /> Historial de sesiones
                  {sessions.length > 0 && (
                    <span className="bg-primary text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {sessions.length}
                    </span>
                  )}
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant transition-colors text-label-md font-medium"
                  onClick={exportPdf}
                  title="Exportar auditoría PDF"
                  disabled={!activeSessionId || messages.length === 0}
                >
                  <Download size={16} /> Exportar PDF
                </button>
              </div>
              <button
                className={`w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center transition-all shadow-sm ${
                  isThinking || !input.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'
                }`}
                onClick={() => sendMessage(input)}
                disabled={isThinking || !input.trim()}
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </div>
          <p className="text-center text-[11px] text-on-surface-variant/60 font-medium">
            La IA puede cometer errores. Verifica siempre la información clave con las fuentes directas.
          </p>
        </div>
      </div>

      {/* ── Session History Drawer ──────────────────────────────────────────── */}
      {isHistoryOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setIsHistoryOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-[400px] bg-surface-container-lowest border-l border-outline-variant shadow-2xl z-50 flex flex-col">
            {/* Drawer Header */}
            <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface shrink-0">
              <div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Historial de Sesiones</h3>
                <p className="text-label-sm text-on-surface-variant mt-0.5">
                  {sessions.length} conversación{sessions.length !== 1 ? 'es' : ''} guardada{sessions.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                className="p-2 hover:bg-surface-container-high rounded-full transition-colors"
                onClick={() => setIsHistoryOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* New Session Button */}
            <div className="p-4 border-b border-outline-variant">
              <button
                onClick={createNewSession}
                className="w-full py-3 flex items-center justify-center gap-2 border-2 border-dashed border-outline-variant rounded-xl text-on-surface-variant font-label-md font-bold hover:bg-surface-container-low hover:text-on-surface transition-colors"
              >
                <Plus size={18} /> Iniciar Nueva Conversación
              </button>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
              {sessions.length === 0 ? (
                <div className="py-16 text-center text-on-surface-variant px-6">
                  <Clock className="mx-auto mb-3 opacity-40" size={40} />
                  <p className="text-body-md font-medium">No hay sesiones guardadas</p>
                  <p className="text-label-sm mt-1">Inicia una conversación con el agente para que aparezca aquí.</p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const msgCount = session.messages.length;
                    const userMsgCount = session.messages.filter((m) => m.role === 'user').length;

                    return (
                      <div
                        key={session.id}
                        className={`group rounded-xl border p-4 cursor-pointer transition-all ${
                          isActive
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low'
                        }`}
                        onClick={() => {
                          setActiveSessionId(session.id);
                          setNextId(
                            session.messages.length > 0
                              ? Math.max(...session.messages.map((m) => m.id)) + 1
                              : 1
                          );
                          setIsHistoryOpen(false);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {isActive && (
                                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                              )}
                              <p className={`text-label-md font-bold truncate ${isActive ? 'text-primary' : 'text-on-surface'}`}>
                                {session.title}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                              <span>{userMsgCount} pregunta{userMsgCount !== 1 ? 's' : ''}</span>
                              <span>·</span>
                              <span>{msgCount} mensaje{msgCount !== 1 ? 's' : ''}</span>
                              <span>·</span>
                              <span>{timeAgo(session.updatedAt)}</span>
                            </div>
                          </div>

                          {/* Delete button */}
                          <button
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-error-container text-on-surface-variant hover:text-error transition-all shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(session.id);
                            }}
                            title="Eliminar sesión"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Preview of last message */}
                        {session.messages.length > 0 && (
                          <p className="mt-2 text-[11px] text-on-surface-variant/80 truncate leading-relaxed">
                            {session.messages[session.messages.length - 1].role === 'agent' ? '🤖 ' : '👤 '}
                            {session.messages[session.messages.length - 1].text.slice(0, 80)}
                            {session.messages[session.messages.length - 1].text.length > 80 ? '…' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
