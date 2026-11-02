import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ejecutarConsultaInforme,
  generarPropuestaInformeLocal,
  validarYNormalizarConsultaSelect,
} from '../src/core/reports';
import { sqliteClient } from '../src/core/workers/sqliteClient';
import { generarDDLSQLite } from '../src/core/ddl/sqlite';
import { generarDatosEjemploLocales, generarInsertStatementsSQLite } from '../src/core/sampleData';
import { Informe, Modelo, PropuestaInformeIASchema } from '../src/core/schemas';
import {
  Step8Informes,
  generarSugerenciasDesdeModelo,
  informeAMarkdown,
} from '../src/steps/Step8Informes';

const MODELO: Modelo = {
  entidades: [
    {
      nombre: 'Autor',
      descripcion: 'Autores de libros',
      atributos: [
        { nombre: 'id', tipoConceptual: 'entero', esClavePrimaria: true, obligatorio: true, unico: true, justificacion: 'PK' },
        { nombre: 'nombre', tipoConceptual: 'texto', esClavePrimaria: false, obligatorio: true, unico: false, justificacion: 'Nombre' },
      ],
    },
    {
      nombre: 'Libro',
      descripcion: 'Libros del catálogo',
      atributos: [
        { nombre: 'id', tipoConceptual: 'entero', esClavePrimaria: true, obligatorio: true, unico: true, justificacion: 'PK' },
        { nombre: 'titulo', tipoConceptual: 'texto', esClavePrimaria: false, obligatorio: true, unico: false, justificacion: 'Título' },
        { nombre: 'paginas', tipoConceptual: 'entero', esClavePrimaria: false, obligatorio: false, unico: false, justificacion: 'Extensión' },
        { nombre: 'id_autor', tipoConceptual: 'entero', esClavePrimaria: false, obligatorio: true, unico: false, justificacion: 'FK hacia Autor' },
      ],
    },
  ],
  relaciones: [
    {
      origen: 'Autor',
      destino: 'Libro',
      cardinalidad: '1:N',
      descripcion: 'Un autor escribe muchos libros',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: true,
    },
  ],
};

const INFORME_BASE: Informe = {
  id: 'inf_md',
  titulo: 'Libros por autor',
  pedidoLenguajeNatural: 'Cuántos libros tiene cada autor',
  consultaSQL: 'SELECT 1 AS total LIMIT 1;',
  explicacionPasoAPaso: '1. SELECT cuenta.',
  tipoGrafico: 'barras',
  resultado: { columnas: ['autor', 'total'], filas: [['Borges | J.L.', 3]], totalFilas: 1, tiempoMs: 1 },
  fechaCreacion: new Date().toISOString(),
};

describe('Fase 5 (completa) — Generador local de informes y ejecución real', () => {
  beforeEach(async () => {
    await sqliteClient.reiniciar();
    await sqliteClient.ejecutarDDL(generarDDLSQLite(MODELO));
    await sqliteClient.insertarDatos(generarInsertStatementsSQLite(generarDatosEjemploLocales(MODELO, 4)));
  });

  it('genera un SELECT local válido y seguro que se ejecuta sobre el esquema real', async () => {
    const propuesta = generarPropuestaInformeLocal(MODELO, 'cuántos libros hay por autor');
    expect(validarYNormalizarConsultaSelect(propuesta.consultaSQL).valido).toBe(true);
    expect(propuesta.tipoGraficoSugerido).toBe('barras');

    const res = await ejecutarConsultaInforme(propuesta.consultaSQL);
    expect(res.columnas).toEqual(['categoria', 'total']);
    expect(res.totalFilas).toBeGreaterThan(0);
  });

  it('genera un JOIN local cuando el pedido menciona datos combinados', async () => {
    const propuesta = generarPropuestaInformeLocal(MODELO, 'listar datos combinados con JOIN');
    expect(propuesta.consultaSQL).toMatch(/JOIN/i);
    const res = await ejecutarConsultaInforme(propuesta.consultaSQL);
    expect(res.totalFilas).toBe(4);
  });

  it('fuerza LIMIT máximo de 100 aunque la consulta pida más', () => {
    const res = validarYNormalizarConsultaSelect('SELECT * FROM Libro LIMIT 5000;');
    expect(res.valido).toBe(true);
    expect(res.sqlNormalizado).toContain('LIMIT 100');
  });
});

describe('Fase 5 (completa) — Normalización tolerante de la propuesta IA', () => {
  it('acepta sinónimos de claves y tipos de gráfico en inglés', () => {
    const parsed = PropuestaInformeIASchema.parse({
      title: 'Top libros',
      sql: 'SELECT titulo FROM Libro LIMIT 5;',
      explanation: 'Explicación',
      chartType: 'Bar chart',
      summary: 'Resumen',
    });
    expect(parsed.titulo).toBe('Top libros');
    expect(parsed.consultaSQL).toContain('SELECT');
    expect(parsed.tipoGraficoSugerido).toBe('barras');
  });

  it('rechaza propuestas sin consulta SQL', () => {
    expect(() => PropuestaInformeIASchema.parse({ titulo: 'x' })).toThrow();
  });
});

describe('Fase 5 (completa) — Sugerencias y exportación Markdown', () => {
  it('genera sugerencias basadas en las entidades y relaciones del modelo', () => {
    const sug = generarSugerenciasDesdeModelo(MODELO);
    expect(sug.length).toBeGreaterThan(0);
    expect(sug.join(' ')).toContain('Libro');
    expect(sug.join(' ')).toContain('Autor');
  });

  it('usa sugerencias genéricas cuando el modelo está vacío', () => {
    const sug = generarSugerenciasDesdeModelo({ entidades: [], relaciones: [] });
    expect(sug.length).toBe(4);
  });

  it('convierte el informe a Markdown con SQL, explicación y tabla escapada', () => {
    const md = informeAMarkdown(INFORME_BASE);
    expect(md).toContain('# Libros por autor');
    expect(md).toContain('```sql');
    expect(md).toContain('## Explicación paso a paso');
    expect(md).toContain('| autor | total |');
    expect(md).toContain('Borges \\| J.L.');
  });
});

describe('Fase 5 (completa) — UI: eliminar informe, descargar .md y aviso de respaldo', () => {
  it('permite eliminar el informe activo y muestra aviso si no hay datos de ejemplo', () => {
    const onEliminarInforme = vi.fn();
    const onRegistrarDecision = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <Step8Informes
        modelo={MODELO}
        informes={[INFORME_BASE]}
        informesConfirmados={false}
        onGenerarInformeConIA={vi.fn()}
        onGuardarOActualizarInforme={vi.fn()}
        onEliminarInforme={onEliminarInforme}
        onConfirmarInformes={vi.fn()}
        onVolverPaso7={vi.fn()}
        onRegistrarDecision={onRegistrarDecision}
      />
    );

    expect(screen.getByTestId('aviso-datos-respaldo')).toBeInTheDocument();
    expect(screen.getByTestId('btn-descargar-md')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-eliminar-informe'));
    expect(onEliminarInforme).toHaveBeenCalledWith('inf_md');
    expect(onRegistrarDecision).toHaveBeenCalledWith(
      expect.stringContaining('Eliminó el informe'),
      'estudiante'
    );
  });
});
