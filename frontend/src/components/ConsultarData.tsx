import { useState, type FormEvent } from 'react';
import { validateSri, type SriValidationResponse } from '../services/api';

export default function ConsultarData() {
  const [ruc, setRuc] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SriValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const normalized = ruc.replace(/\D/g, '');
    if (!normalized) {
      setError('Por favor ingresa un RUC válido.');
      return;
    }

    setLoading(true);
    try {
      const response = await validateSri(normalized);
      setResult(response);
    } catch (err) {
      setError((err as Error).message || 'Error en la consulta SRI.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-outline-variant bg-surface-container-high p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-on-surface">Consultar data</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Ingresa un RUC para validar su estado en la consulta SRI y detectar posibles incoherencias.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-on-surface">RUC</span>
          <input
            type="text"
            value={ruc}
            onChange={(event) => setRuc(event.target.value)}
            placeholder="Ingrese RUC de la empresa"
            className="rounded-2xl border border-outline-variant bg-surface-container px-4 py-3 text-on-surface outline-none transition focus:border-primary"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-focus disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Consultando...' : 'Consultar'}
        </button>
      </form>

      {error ? (
        <div className="rounded-3xl border border-destructive-container bg-destructive-container/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <div className="rounded-3xl border border-outline-variant bg-surface-container-high p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.08em] text-on-surface-variant">Resultado SRI</p>
                <h2 className="text-2xl font-semibold text-on-surface">{result.ruc}</h2>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${result.exists ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                {result.exists ? 'Registrado' : 'No registrado'}
              </span>
            </div>
            <p className="mt-4 text-sm text-on-surface-variant">{result.message}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-outline-variant bg-surface-container-high p-6">
              <h3 className="text-lg font-semibold text-on-surface">Detalles del RUC</h3>
              <dl className="mt-4 grid gap-3">
                <div className="grid gap-1">
                  <dt className="text-sm text-on-surface-variant">Tipo</dt>
                  <dd className="text-base font-medium text-on-surface">{result.tipo || 'N/A'}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-sm text-on-surface-variant">Sucursal</dt>
                  <dd className="text-base font-medium text-on-surface">{result.sucursal || 'N/A'}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-sm text-on-surface-variant">Sucursal principal</dt>
                  <dd className="text-base font-medium text-on-surface">{result.main_branch ? 'Sí' : 'No'}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-outline-variant bg-surface-container-high p-6">
              <h3 className="text-lg font-semibold text-on-surface">Datos SRI</h3>
              <pre className="mt-4 max-h-72 overflow-auto rounded-2xl bg-surface-container p-4 text-xs leading-6 text-on-surface-variant">
                {JSON.stringify(result.sri || { message: 'No hay datos estructurados disponibles' }, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
