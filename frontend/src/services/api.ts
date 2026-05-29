// frontend/src/services/api.ts
/**
 * Central API service for Fraudia Claims backend.
 * All HTTP calls are funnelled through this module so the base URL
 * only needs changing in one place.
 */

export const API_BASE =
  (import.meta as any).env?.VITE_API_URL ?? 'https://fraudia-claims-web.onrender.com';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Claim {
  id_siniestro: number;
  id_poliza: number;
  id_asegurado: number;
  ramo: string;
  cobertura: string;
  fecha_ocurrencia: string;
  fecha_reporte: string;
  monto_reclamado: number;
  monto_estimado: number;
  sucursal: string;
  beneficiario: string;
  estado: string;
  descripcion: string;
  // Evaluation fields (returned by evaluate_record)
  final_color: 'rojo' | 'amarillo' | 'verde';
  final_score: number;
  soft_score: number;
  hard_score: number;
  soft_alerts: string[];
  hard_alerts: string[];
  dias_desde_inicio_poliza?: number;
  dias_entre_ocurrencia_reporte?: number;
  documentos_completos?: string;
  documentos?: ClaimDocument[];
  is_anomaly?: boolean;
}

export interface ClaimDocument {
  id_documento: string;
  id_siniestro: number;
  tipo_documento: string;
  entregado: string;
  legible: string;
  fecha_emision: string | null;
  inconsistencia_detectada: string;
  observacion: string | null;
  archivo_pdf?: string;
}

export interface ClaimsListResponse {
  total: number;
  page: number;
  limit: number;
  data: Claim[];
}

export interface EvaluationResponse {
  final_color: 'rojo' | 'amarillo' | 'verde';
  final_score: number;
  soft_score: number;
  hard_score: number;
  soft_alerts: string[];
  hard_alerts: string[];
  ml_probability: number;
  combined_score: number;
  is_anomaly?: boolean;
}

export interface ExplainResponse {
  id_siniestro: number | string;
  explanation: string;
  combined_score: number;
}

export interface ChatResponse {
  answer: string;
}

export async function exportAgentPdf(payload: {
  title?: string;
  messages: { role: 'user' | 'agent'; text: string }[];
}): Promise<Blob> {
  const url = `${API_BASE}/api/agent/export_pdf`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorBody.error ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchClaimHit {
  id_siniestro: string;
  id_poliza: string;
  id_asegurado: string;
  ramo?: string;
  cobertura?: string;
  fecha_ocurrencia?: string;
  monto_reclamado?: number;
  beneficiario?: string;
  asegurado_nombre?: string;
  proveedor_nombre?: string;
}

export interface SearchPolicyHit {
  id_poliza: string;
  id_asegurado: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  suma_asegurada?: number;
}

export interface SearchProviderHit {
  id_proveedor: string;
  nombre: string;
  tipo_proveedor?: string;
}

export interface SearchInsuredHit {
  id_asegurado: string;
  cedula?: string;
  nombre?: string;
}

export interface SearchResponse {
  query: string;
  claims: SearchClaimHit[];
  policies: SearchPolicyHit[];
  providers: SearchProviderHit[];
  insured: SearchInsuredHit[];
}

export async function searchGlobal(q: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  return apiFetch<SearchResponse>(`/api/search?${params}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorBody.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Claims ───────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated list of claims, optionally filtered by risk colour.
 */
export async function fetchClaims(
  page = 1,
  limit = 20,
  color?: 'rojo' | 'amarillo' | 'verde',
): Promise<ClaimsListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (color) params.set('color', color);
  return apiFetch<ClaimsListResponse>(`/api/claims?${params}`);
}

/**
 * Fetch a single claim with its fraud evaluation.
 */
export async function fetchClaim(id: number | string): Promise<Claim> {
  return apiFetch<Claim>(`/api/claims/${id}`);
}

export async function createManualClaim(payload: Record<string, any>): Promise<{ success: boolean; id_siniestro: string }> {
  return apiFetch<{ success: boolean; id_siniestro: string }>(`/api/claims/manual`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Run the full evaluation pipeline (rules + ML) on a single claim.
 */
export async function evaluateClaim(
  id: number | string,
): Promise<EvaluationResponse> {
  return apiFetch<EvaluationResponse>(`/api/claims/${id}/evaluate`, {
    method: 'POST',
  });
}

/**
 * Generate an AI-powered Gemini explanation for a claim's risk score.
 */
export async function explainClaim(
  id: number | string,
): Promise<ExplainResponse> {
  return apiFetch<ExplainResponse>(`/api/claims/${id}/explain`, {
    method: 'POST',
  });
}

// ── Agent ────────────────────────────────────────────────────────────────────

/**
 * Send a question to the conversational RAG agent (ClaimsAgent / Gemini).
 */
export async function chatWithAgent(question: string): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

// ── Network ──────────────────────────────────────────────────────────────────

export interface NetworkNode {
  id: string;
  label: string;
  type: 'claim' | 'insured' | 'provider' | 'vehicle';
  score?: number;
  color?: 'rojo' | 'amarillo' | 'verde';
  ramo?: string;
  cobertura?: string;
  monto?: number;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface NetworkGraphResponse {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export async function fetchNetworkGraph(): Promise<NetworkGraphResponse> {
  return apiFetch<NetworkGraphResponse>('/api/network/graph');
}

// ── Health ───────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/health');
}

// ── Entities (Providers) ─────────────────────────────────────────────────────

export interface ProviderRisk {
  id_proveedor: string;
  nombre: string;
  tipo: string;
  total_siniestros: number;
  siniestros_rojos: number;
  siniestros_amarillos: number;
  tasa_siniestralidad: number;
  asegurados_vinculados: { id: string; name: string }[];
}

export async function getProviderRisk(): Promise<ProviderRisk[]> {
  return apiFetch<ProviderRisk[]>('/api/entities/providers');
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface ReportStats {
  ahorro_potencial: number;
  monto_total: number;
  heatmap_data: { sucursal: string; siniestros_rojos: number }[];
  riesgo_por_ramo: { ramo: string; siniestros_rojos: number }[];
}

export async function getReportStats(): Promise<ReportStats> {
  return apiFetch<ReportStats>('/api/reports/stats');
}

// ── Notion Integration ───────────────────────────────────────────────────────

export async function exportToNotion(claims: Claim[]): Promise<{ success: boolean; url: string }> {
  return apiFetch<{ success: boolean; url: string }>('/api/notion/export', {
    method: 'POST',
    body: JSON.stringify({ claims }),
  });
}
