import { useId, useMemo, useRef, useState } from 'react';
import { TipoGraficoInforme } from '../core/schemas';
import { descargarArchivo, exportarSvgAPng } from '../export/svg';

export interface DatoGrafico {
  etiqueta: string;
  valor: number;
}

export interface ChartVisualizerProps {
  tipo: TipoGraficoInforme;
  datos: DatoGrafico[];
  titulo?: string;
  ancho?: number;
  alto?: number;
  onDescargarGrafico?: (formato: 'svg' | 'png') => void;
}

const PALETA_COLORES = [
  '#38bdf8', // Cyan
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
  '#f97316', // Orange
];

export function ChartVisualizer({
  tipo,
  datos,
  titulo = 'Gráfico de Informe',
  ancho = 640,
  alto = 340,
  onDescargarGrafico,
}: ChartVisualizerProps) {
  const chartId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [descargandoPng, setDescargandoPng] = useState(false);

  // Filtrar y sanitizar datos numéricos válidos
  const datosFiltrados = useMemo(() => {
    return datos
      .filter((d) => Number.isFinite(d.valor) && d.valor >= 0)
      .slice(0, 15); // Limitar a máximo 15 elementos para legibilidad visual
  }, [datos]);

  const totalSuma = useMemo(() => {
    return datosFiltrados.reduce((acc, d) => acc + d.valor, 0);
  }, [datosFiltrados]);

  const valorMaximo = useMemo(() => {
    return Math.max(...datosFiltrados.map((d) => d.valor), 1);
  }, [datosFiltrados]);

  const handleDescargarSvg = () => {
    if (!svgRef.current) return;
    const svgContent = new XMLSerializer().serializeToString(svgRef.current);
    descargarArchivo(svgContent, `${titulo.toLowerCase().replace(/\s+/g, '_')}.svg`, 'image/svg+xml');
    onDescargarGrafico?.('svg');
  };

  const handleDescargarPng = async () => {
    if (!svgRef.current) return;
    setDescargandoPng(true);
    try {
      const svgContent = new XMLSerializer().serializeToString(svgRef.current);
      const pngBlob = await exportarSvgAPng(svgContent, 2);
      descargarArchivo(
        pngBlob,
        `${titulo.toLowerCase().replace(/\s+/g, '_')}.png`,
        'image/png'
      );
      onDescargarGrafico?.('png');
    } catch (err) {
      console.error('Error al exportar gráfico PNG:', err);
    } finally {
      setDescargandoPng(false);
    }
  };

  if (tipo === 'ninguno' || datosFiltrados.length === 0) {
    return (
      <div
        className="chart-empty-placeholder"
        style={{
          padding: '1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          background: 'rgba(15, 23, 42, 0.5)',
          borderRadius: '0.65rem',
          border: '1px dashed var(--border-color)',
        }}
        data-testid="chart-placeholder"
      >
        <span>📊 No hay datos numéricos suficientes para trazar un gráfico para este informe.</span>
      </div>
    );
  }

  // --- Gráfico de Barras ---
  const renderBarras = () => {
    const paddingLeft = 60;
    const paddingRight = 30;
    const paddingTop = 40;
    const paddingBottom = 60;
    const chartWidth = ancho - paddingLeft - paddingRight;
    const chartHeight = alto - paddingTop - paddingBottom;

    const barWidth = Math.min(50, Math.max(16, (chartWidth / datosFiltrados.length) * 0.65));
    const stepX = chartWidth / datosFiltrados.length;

    return (
      <g>
        {/* Líneas de cuadrícula horizontal */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
          const y = paddingTop + chartHeight * (1 - pct);
          const valorRef = Math.round(valorMaximo * pct);
          return (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={ancho - paddingRight}
                y2={y}
                stroke="rgba(148, 163, 184, 0.15)"
                strokeDasharray="4 4"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#94a3b8"
                fontFamily="sans-serif"
              >
                {valorRef}
              </text>
            </g>
          );
        })}

        {/* Ejes X e Y */}
        <line
          x1={paddingLeft}
          y1={paddingTop + chartHeight}
          x2={ancho - paddingRight}
          y2={paddingTop + chartHeight}
          stroke="#475569"
          strokeWidth="1.5"
        />
        <line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={paddingTop + chartHeight}
          stroke="#475569"
          strokeWidth="1.5"
        />

        {/* Barras individuales */}
        {datosFiltrados.map((item, idx) => {
          const x = paddingLeft + idx * stepX + (stepX - barWidth) / 2;
          const alturaBarra = (item.valor / valorMaximo) * chartHeight;
          const y = paddingTop + chartHeight - alturaBarra;
          const color = PALETA_COLORES[idx % PALETA_COLORES.length];

          return (
            <g key={idx} className="chart-bar-group">
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, alturaBarra)}
                fill={color}
                rx="4"
                opacity="0.9"
                style={{ transition: 'all 0.3s ease' }}
              >
                <title>{`${item.etiqueta}: ${item.valor}`}</title>
              </rect>

              {/* Valor numérico encima de la barra */}
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#f1f5f9"
                fontFamily="sans-serif"
              >
                {item.valor}
              </text>

              {/* Etiqueta de categoría en el eje X */}
              <text
                x={x + barWidth / 2}
                y={paddingTop + chartHeight + 18}
                textAnchor="middle"
                fontSize="11"
                fill="#cbd5e1"
                fontFamily="sans-serif"
              >
                {item.etiqueta.length > 12 ? `${item.etiqueta.slice(0, 10)}…` : item.etiqueta}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  // --- Gráfico de Torta / Donut ---
  const renderTorta = () => {
    const cx = ancho * 0.38;
    const cy = alto * 0.52;
    const radioExterior = Math.min(cx, cy) * 0.78;
    const radioInterior = radioExterior * 0.45; // Efecto Donut legible

    let anguloInicio = -Math.PI / 2;

    const sectores = datosFiltrados.map((item, idx) => {
      const fraccion = totalSuma > 0 ? item.valor / totalSuma : 1 / datosFiltrados.length;
      const anguloFin = anguloInicio + fraccion * 2 * Math.PI;

      const x1Ext = cx + radioExterior * Math.cos(anguloInicio);
      const y1Ext = cy + radioExterior * Math.sin(anguloInicio);
      const x2Ext = cx + radioExterior * Math.cos(anguloFin);
      const y2Ext = cy + radioExterior * Math.sin(anguloFin);

      const x1Int = cx + radioInterior * Math.cos(anguloInicio);
      const y1Int = cy + radioInterior * Math.sin(anguloInicio);
      const x2Int = cx + radioInterior * Math.cos(anguloFin);
      const y2Int = cy + radioInterior * Math.sin(anguloFin);

      const granArco = fraccion > 0.5 ? 1 : 0;

      // Ruta SVG para sector tipo donut
      const d = [
        `M ${x1Ext} ${y1Ext}`,
        `A ${radioExterior} ${radioExterior} 0 ${granArco} 1 ${x2Ext} ${y2Ext}`,
        `L ${x2Int} ${y2Int}`,
        `A ${radioInterior} ${radioInterior} 0 ${granArco} 0 ${x1Int} ${y1Int}`,
        'Z',
      ].join(' ');

      anguloInicio = anguloFin;

      return {
        item,
        d,
        color: PALETA_COLORES[idx % PALETA_COLORES.length],
        porcentaje: Math.round(fraccion * 100),
      };
    });

    return (
      <g>
        {sectores.map((sec, idx) => (
          <path
            key={idx}
            d={sec.d}
            fill={sec.color}
            stroke="#0b1120"
            strokeWidth="2"
            opacity="0.92"
          >
            <title>{`${sec.item.etiqueta}: ${sec.item.valor} (${sec.porcentaje}%)`}</title>
          </path>
        ))}

        {/* Leyenda al lado derecho */}
        <g transform={`translate(${ancho * 0.72}, 45)`}>
          {datosFiltrados.map((item, idx) => {
            const color = PALETA_COLORES[idx % PALETA_COLORES.length];
            const pct = totalSuma > 0 ? Math.round((item.valor / totalSuma) * 100) : 0;
            return (
              <g key={idx} transform={`translate(0, ${idx * 20})`}>
                <rect width="12" height="12" rx="2" fill={color} />
                <text
                  x="18"
                  y="10"
                  fontSize="11"
                  fill="#e2e8f0"
                  fontFamily="sans-serif"
                >
                  {item.etiqueta.length > 14 ? `${item.etiqueta.slice(0, 12)}…` : item.etiqueta}{' '}
                  <tspan fill="#94a3b8">({pct}%)</tspan>
                </text>
              </g>
            );
          })}
        </g>
      </g>
    );
  };

  // --- Gráfico de Líneas ---
  const renderLineas = () => {
    const paddingLeft = 60;
    const paddingRight = 30;
    const paddingTop = 40;
    const paddingBottom = 60;
    const chartWidth = ancho - paddingLeft - paddingRight;
    const chartHeight = alto - paddingTop - paddingBottom;
    const stepX = chartWidth / Math.max(1, datosFiltrados.length - 1);

    const puntos = datosFiltrados.map((item, idx) => {
      const x = paddingLeft + idx * stepX;
      const y = paddingTop + chartHeight - (item.valor / valorMaximo) * chartHeight;
      return { x, y, item };
    });

    const puntosStr = puntos.map((p) => `${p.x},${p.y}`).join(' ');

    return (
      <g>
        {/* Grilla */}
        {[0, 0.5, 1].map((pct, idx) => {
          const y = paddingTop + chartHeight * (1 - pct);
          return (
            <line
              key={idx}
              x1={paddingLeft}
              y1={y}
              x2={ancho - paddingRight}
              y2={y}
              stroke="rgba(148, 163, 184, 0.15)"
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Línea poligonal */}
        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth="3"
          points={puntosStr}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Puntos y etiquetas */}
        {puntos.map((p, idx) => (
          <g key={idx}>
            <circle cx={p.x} cy={p.y} r="5" fill="#38bdf8" stroke="#090e1c" strokeWidth="2">
              <title>{`${p.item.etiqueta}: ${p.item.valor}`}</title>
            </circle>
            <text
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#f1f5f9"
              fontFamily="sans-serif"
            >
              {p.item.valor}
            </text>
            <text
              x={p.x}
              y={paddingTop + chartHeight + 18}
              textAnchor="middle"
              fontSize="10"
              fill="#cbd5e1"
              fontFamily="sans-serif"
            >
              {p.item.etiqueta}
            </text>
          </g>
        ))}
      </g>
    );
  };

  return (
    <div
      className="chart-container-card"
      style={{
        background: 'rgba(11, 17, 32, 0.85)',
        border: '1px solid var(--border-color)',
        borderRadius: '0.75rem',
        padding: '1.25rem',
        marginTop: '1rem',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
      }}
      data-testid="chart-visualizer-container"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '0.85rem',
        }}
      >
        <h4 style={{ margin: 0, fontSize: '1rem', color: '#93c5fd' }}>
          📈 {titulo} ({tipo.toUpperCase()})
        </h4>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={handleDescargarSvg}
            data-testid="btn-download-chart-svg"
          >
            📥 Descargar SVG
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={handleDescargarPng}
            disabled={descargandoPng}
            data-testid="btn-download-chart-png"
          >
            {descargandoPng ? '⏳ PNG...' : '📥 Descargar PNG'}
          </button>
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto', display: 'flex', justifyContent: 'center' }}>
        <svg
          ref={svgRef}
          id={chartId}
          width={ancho}
          height={alto}
          viewBox={`0 0 ${ancho} ${alto}`}
          style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label={titulo}
          data-testid="chart-svg-element"
        >
          {/* Fondo oscuro para que al exportar a PNG o SVG no sea transparente */}
          <rect width={ancho} height={alto} fill="#0b1120" rx="8" />

          {tipo === 'barras' && renderBarras()}
          {tipo === 'torta' && renderTorta()}
          {tipo === 'lineas' && renderLineas()}
        </svg>
      </div>
    </div>
  );
}
