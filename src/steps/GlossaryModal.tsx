import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  buscarTerminosGlosario,
  CategoriaGlosario,
  obtenerTerminosGlosario,
  TerminoGlosario,
} from '../core/glossary';
import { ProyectoEstado } from '../core/schemas';

export interface GlossaryModalProps {
  abierto: boolean;
  onCerrar: () => void;
  proyecto?: ProyectoEstado;
}

const CATEGORIAS_INFO: { id: CategoriaGlosario | 'todas'; etiqueta: string; emoji: string }[] = [
  { id: 'todas', etiqueta: 'Todos los Conceptos', emoji: '📚' },
  { id: 'conceptual', etiqueta: 'Diseño Conceptual', emoji: '💡' },
  { id: 'relacional', etiqueta: 'Modelo Relacional & SQL', emoji: '🏛️' },
  { id: 'nosql', etiqueta: 'NoSQL & MongoDB', emoji: '🍃' },
  { id: 'consultas', etiqueta: 'Consultas & Informes', emoji: '🔍' },
];

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  abierto,
  onCerrar,
  proyecto,
}) => {
  const dialogId = useId();
  const titleId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState<CategoriaGlosario | 'todas'>('todas');
  const [soloRelevantes, setSoloRelevantes] = useState(false);

  // Focus trap y escape key
  useEffect(() => {
    if (!abierto) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCerrar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Auto-focus en el buscador al abrir
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [abierto, onCerrar]);

  const terminosFiltrados: TerminoGlosario[] = useMemo(() => {
    const cat = categoriaActiva === 'todas' ? undefined : categoriaActiva;
    return buscarTerminosGlosario(busqueda, cat, proyecto, soloRelevantes);
  }, [busqueda, categoriaActiva, proyecto, soloRelevantes]);

  const totalRelevantes = useMemo(() => {
    if (!proyecto) return 0;
    return obtenerTerminosGlosario(proyecto, true).length;
  }, [proyecto]);

  if (!abierto) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      data-testid="glossary-modal-overlay"
    >
      <div
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card glossary-modal-card"
        data-testid="glossary-modal"
      >
        {/* Encabezado del Modal */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.6rem' }} aria-hidden="true">
              📖
            </span>
            <div>
              <h2 id={titleId} className="modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
                Glosario Pedagógico de Bases de Datos
              </h2>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Definiciones conceptuales claras con ejemplos prácticos para acompañar tu aprendizaje.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCerrar}
            aria-label="Cerrar glosario"
            data-testid="close-glossary-btn"
            style={{ minWidth: '2.2rem', padding: '0.35rem 0.6rem' }}
          >
            ✕
          </button>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="glossary-toolbar">
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 240px', position: 'relative' }}>
              <input
                ref={searchInputRef}
                type="search"
                className="text-input"
                placeholder="Buscar concepto (ej: Clave Foránea, BSON, JOIN, Normalización)..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                aria-label="Buscar concepto en el glosario"
                data-testid="glossary-search-input"
                style={{ width: '100%', paddingLeft: '2.2rem' }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  opacity: 0.6,
                }}
                aria-hidden="true"
              >
                🔍
              </span>
            </div>

            {proyecto && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                  color: soloRelevantes ? 'var(--accent-cyan)' : 'var(--text-muted)',
                }}
              >
                <input
                  type="checkbox"
                  checked={soloRelevantes}
                  onChange={(e) => setSoloRelevantes(e.target.checked)}
                  data-testid="glossary-relevant-filter"
                />
                <span>Solo de mi sesión ({totalRelevantes})</span>
              </label>
            )}
          </div>

          {/* Chips de Categorías */}
          <div
            className="glossary-categories"
            style={{
              display: 'flex',
              gap: '0.4rem',
              flexWrap: 'wrap',
              marginTop: '0.75rem',
            }}
          >
            {CATEGORIAS_INFO.map((cat) => {
              const activa = categoriaActiva === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`btn ${activa ? 'btn-primary' : 'btn-secondary'} btn-xs`}
                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                  onClick={() => setCategoriaActiva(cat.id)}
                  aria-pressed={activa}
                  data-testid={`glossary-chip-${cat.id}`}
                >
                  <span aria-hidden="true">{cat.emoji}</span> {cat.etiqueta}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de Conceptos */}
        <div
          className="glossary-list"
          style={{
            maxHeight: '480px',
            overflowY: 'auto',
            paddingRight: '0.35rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
            marginTop: '1rem',
          }}
          data-testid="glossary-items-list"
        >
          {terminosFiltrados.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                color: 'var(--text-muted)',
                background: 'rgba(15, 23, 42, 0.4)',
                borderRadius: '0.75rem',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔎</div>
              <p style={{ margin: 0, fontWeight: 600 }}>
                No encontramos conceptos para "{busqueda}".
              </p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
                Probá con otro término o limpiá los filtros de búsqueda.
              </p>
            </div>
          ) : (
            terminosFiltrados.map((item) => (
              <article
                key={item.id}
                className="glossary-entry-card"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '0.75rem',
                  padding: '1rem 1.15rem',
                  transition: 'all 0.2s ease',
                }}
                data-testid={`glossary-entry-${item.id}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    marginBottom: '0.4rem',
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '1rem',
                      color: 'var(--accent-cyan)',
                      fontWeight: 700,
                    }}
                  >
                    {item.termino}
                  </h3>
                  <span
                    className="badge"
                    style={{
                      fontSize: '0.7rem',
                      textTransform: 'uppercase',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '0.3rem',
                      background: 'rgba(56, 189, 248, 0.12)',
                      color: 'var(--accent-cyan)',
                      fontWeight: 600,
                    }}
                  >
                    {item.categoria}
                  </span>
                </div>

                <p
                  style={{
                    margin: '0 0 0.6rem',
                    fontSize: '0.86rem',
                    color: 'var(--text-main)',
                    lineHeight: 1.5,
                  }}
                >
                  {item.definicion}
                </p>

                <div
                  style={{
                    background: 'var(--bg-input)',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: '#93c5fd',
                    border: '1px solid rgba(56, 189, 248, 0.15)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <span aria-hidden="true">💡</span>
                  <div>
                    <strong style={{ color: '#e0f2fe' }}>Ejemplo concreto:</strong>{' '}
                    <span>{item.ejemploConcreto}</span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {/* Pie del modal */}
        <div
          style={{
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>Mostrando {terminosFiltrados.length} conceptos</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCerrar}
            data-testid="glossary-footer-close-btn"
          >
            Entendido, volver al asistente
          </button>
        </div>
      </div>
    </div>
  );
};
