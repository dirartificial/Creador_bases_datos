import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ejecutarConsultaInforme,
  generarConsultaInformeConIA,
  validarYNormalizarConsultaSelect,
} from '../src/core/reports';
import { sqliteClient } from '../src/core/workers/sqliteClient';
import { generarDDLSQLite } from '../src/core/ddl/sqlite';
import { configurarClienteGeminiMock } from '../src/core/gemini';
import { guardarApiKey } from '../src/core/key';
import { Informe, Modelo } from '../src/core/schemas';
import { ChartVisualizer } from '../src/steps/ChartVisualizer';
import { Step8Informes } from '../src/steps/Step8Informes';
import { reiniciarProyectoEnIndexedDB } from '../src/core/storage';

const MODELO_TIENDA: Modelo = {
  entidades: [
    {
      nombre: 'Categoria',
      descripcion: 'Categorías de productos en venta',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          esClavePrimaria: true,
          obligatorio: true,
          unico: true,
          justificacion: 'Identificador único de categoría.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          esClavePrimaria: false,
          obligatorio: true,
          unico: true,
          justificacion: 'Nombre del rubro.',
        },
      ],
    },
    {
      nombre: 'Producto',
      descripcion: 'Artículos ofrecidos a los clientes',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          esClavePrimaria: true,
          obligatorio: true,
          unico: true,
          justificacion: 'ID del producto.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Nombre comercial del producto.',
        },
        {
          nombre: 'precio',
          tipoConceptual: 'decimal',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Precio unitario.',
        },
        {
          nombre: 'id_categoria',
          tipoConceptual: 'entero',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Clave foránea apuntando a Categoria.',
        },
      ],
    },
  ],
  relaciones: [
    {
      origen: 'Categoria',
      destino: 'Producto',
      cardinalidad: '1:N',
      descripcion: 'Una categoría contiene varios productos',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: true,
    },
  ],
};

describe('Fase 5 — Seguridad y Validación Estricta de SQL (src/core/reports.ts)', () => {
  it('acepta consultas SELECT estándar válidas y aplica LIMIT por defecto', () => {
    const res = validarYNormalizarConsultaSelect('SELECT id, nombre, precio FROM Producto');
    expect(res.valido).toBe(true);
    expect(res.sqlNormalizado).toContain('SELECT id, nombre, precio FROM Producto');
    expect(res.sqlNormalizado).toMatch(/LIMIT\s+100;/i);
  });

  it('acepta consultas SELECT complejas con JOIN, GROUP BY, ORDER BY y funciones de agregación', () => {
    const sqlComplejo = `
      SELECT Categoria.nombre AS categoria, COUNT(Producto.id) AS total_productos, AVG(Producto.precio) AS precio_promedio
      FROM Categoria
      LEFT JOIN Producto ON Categoria.id = Producto.id_categoria
      GROUP BY Categoria.id
      ORDER BY total_productos DESC
      LIMIT 25;
    `;
    const res = validarYNormalizarConsultaSelect(sqlComplejo);
    expect(res.valido).toBe(true);
    expect(res.sqlNormalizado).toContain('LEFT JOIN Producto');
    expect(res.sqlNormalizado).toContain('LIMIT 25;');
  });

  it('acota una cláusula LIMIT que excede el máximo permitido', () => {
    const res = validarYNormalizarConsultaSelect('SELECT * FROM Producto LIMIT 500;', 100);
    expect(res.valido).toBe(true);
    expect(res.sqlNormalizado).toContain('LIMIT 100;');
    expect(res.sqlNormalizado).not.toContain('LIMIT 500;');
  });

  it('rechaza tajantemente sentencias destructivas o de modificación (DROP, DELETE, UPDATE, INSERT, ALTER)', () => {
    const casosInseguros = [
      'DROP TABLE Producto;',
      'DELETE FROM Categoria WHERE id = 1;',
      'UPDATE Producto SET precio = 0;',
      'INSERT INTO Producto (id, nombre, precio) VALUES (1, "Hack", 0);',
      'ALTER TABLE Producto ADD COLUMN secreto TEXT;',
      'CREATE TABLE prueba (id INT);',
    ];

    for (const sqlInseguro of casosInseguros) {
      const res = validarYNormalizarConsultaSelect(sqlInseguro);
      expect(res.valido).toBe(false);
      expect(res.error).toMatch(/solo se permiten consultas|operación no permitida|instrucción no permitida/i);
    }
  });

  it('rechaza inyecciones con múltiples sentencias concatenadas con punto y coma', () => {
    const res = validarYNormalizarConsultaSelect('SELECT * FROM Producto; DROP TABLE Categoria;');
    expect(res.valido).toBe(false);
    expect(res.error).toMatch(/solo se permite una única consulta|múltiples sentencias/i);
  });

  it('rechaza sentencias PRAGMA o comandos administrativos de SQLite', () => {
    const res1 = validarYNormalizarConsultaSelect('PRAGMA foreign_keys = OFF;');
    expect(res1.valido).toBe(false);

    const res2 = validarYNormalizarConsultaSelect("ATTACH DATABASE ':memory:' AS evil;");
    expect(res2.valido).toBe(false);
  });

  it('rechaza funciones no seguras de SQLite como load_extension', () => {
    const res = validarYNormalizarConsultaSelect("SELECT load_extension('evil.so');");
    expect(res.valido).toBe(false);
    expect(res.error).toMatch(/función prohibida|load_extension/i);
  });

  it('rechaza entradas vacías o solo espacios', () => {
    const res = validarYNormalizarConsultaSelect('   ');
    expect(res.valido).toBe(false);
    expect(res.error).toContain('vacía');
  });
});

describe('Fase 5 — Ejecución de Informes en SQLite WASM', () => {
  beforeEach(async () => {
    await sqliteClient.reiniciar();
    const ddl = generarDDLSQLite(MODELO_TIENDA);
    await sqliteClient.ejecutarDDL(ddl);

    await sqliteClient.insertarDatos([
      'INSERT INTO "Categoria" ("id", "nombre") VALUES (1, \'Electrónica\');',
      'INSERT INTO "Categoria" ("id", "nombre") VALUES (2, \'Librería\');',
      'INSERT INTO "Producto" ("id", "nombre", "precio", "id_categoria") VALUES (10, \'Auriculares Bluetooth\', 45000, 1);',
      'INSERT INTO "Producto" ("id", "nombre", "precio", "id_categoria") VALUES (20, \'Teclado Mecánico\', 82000, 1);',
      'INSERT INTO "Producto" ("id", "nombre", "precio", "id_categoria") VALUES (30, \'Cuaderno A4\', 4500, 2);',
    ]);
  });

  it('ejecuta una consulta SELECT y devuelve columnas, filas y métricas de tiempo', async () => {
    const res = await ejecutarConsultaInforme(
      'SELECT "Producto"."nombre", "Producto"."precio", "Categoria"."nombre" AS "categoria" FROM "Producto" JOIN "Categoria" ON "Producto"."id_categoria" = "Categoria"."id" ORDER BY "Producto"."precio" DESC;'
    );

    expect(res.columnas).toEqual(['nombre', 'precio', 'categoria']);
    expect(res.totalFilas).toBe(3);
    expect(res.filas[0][0]).toBe('Teclado Mecánico');
    expect(res.filas[0][1]).toBe(82000);
    expect(res.tiempoMs).toBeGreaterThanOrEqual(0);
  });

  it('falla al intentar ejecutar sentencias peligrosas bloqueándolas antes de llegar a la base', async () => {
    await expect(ejecutarConsultaInforme('DROP TABLE "Producto";')).rejects.toThrow(
      /solo se permiten consultas|operación no permitida/i
    );

    // Verificar que la tabla Producto sigue intacta
    const conteo = await sqliteClient.ejecutarConsulta('SELECT COUNT(*) FROM "Producto";');
    expect(conteo[0].values[0][0]).toBe(3);
  });
});

describe('Fase 5 — Traducción con Tutor IA (generarConsultaInformeConIA)', () => {
  beforeEach(() => {
    guardarApiKey('AIzaSyTestKeyFase5_1234567890abcdefXYZ');
  });

  afterEach(async () => {
    window.sessionStorage.clear();
    await reiniciarProyectoEnIndexedDB();
  });

  it('envía solo el esquema al modelo y devuelve una propuesta validada con Zod', async () => {
    let promptEnviado = '';
    configurarClienteGeminiMock({
      generarContenido: async (params) => {
        promptEnviado = typeof params === 'string' ? params : params.prompt;
        return JSON.stringify({
          titulo: 'Cantidad de productos por categoría',
          consultaSQL:
            'SELECT Categoria.nombre AS categoria, COUNT(Producto.id) AS total FROM Categoria LEFT JOIN Producto ON Categoria.id = Producto.id_categoria GROUP BY Categoria.id ORDER BY total DESC LIMIT 20;',
          explicacionPasoAPaso:
            '1. Usamos SELECT para elegir el nombre de categoría y el conteo.\n2. LEFT JOIN para incluir categorías sin productos.\n3. GROUP BY para agrupar por categoría.',
          tipoGraficoSugerido: 'barras',
          columnaEtiquetas: 'categoria',
          columnaValores: 'total',
          resumenDidactico: 'Permite visualizar qué rubros concentran más oferta de productos.',
        });
      },
    });

    const propuesta = await generarConsultaInformeConIA({
      modelo: MODELO_TIENDA,
      pedidoEstudiante: '¿Cuáles categorías tienen más artículos?',
      descripcionProblema: 'Tienda de artículos varios',
    });

    // La solicitud no debe contener datos reales de filas, solo esquema
    expect(promptEnviado).toContain('Tabla "Categoria"');
    expect(promptEnviado).toContain('Tabla "Producto"');
    expect(promptEnviado).not.toContain('Auriculares Bluetooth');

    expect(propuesta.titulo).toBe('Cantidad de productos por categoría');
    expect(propuesta.tipoGraficoSugerido).toBe('barras');
    expect(propuesta.consultaSQL).toContain('SELECT Categoria.nombre AS categoria');
  });
});

describe('Fase 5 — Visualizador de Gráficos (ChartVisualizer.tsx)', () => {
  it('renderiza un gráfico de barras con sus etiquetas y valores SVG', () => {
    render(
      <ChartVisualizer
        tipo="barras"
        datos={[
          { etiqueta: 'Electrónica', valor: 2 },
          { etiqueta: 'Librería', valor: 1 },
        ]}
        titulo="Productos por Rubro"
      />
    );

    expect(screen.getByTestId('chart-visualizer-container')).toBeInTheDocument();
    expect(screen.getByTestId('chart-svg-element')).toBeInTheDocument();
    expect(screen.getByText('Electrónica')).toBeInTheDocument();
    expect(screen.getByText('Librería')).toBeInTheDocument();
  });

  it('renderiza un gráfico de torta con sectores y leyenda', () => {
    render(
      <ChartVisualizer
        tipo="torta"
        datos={[
          { etiqueta: 'Electrónica', valor: 2 },
          { etiqueta: 'Librería', valor: 1 },
        ]}
        titulo="Distribución de Productos"
      />
    );

    expect(screen.getByTestId('chart-svg-element')).toBeInTheDocument();
    expect(screen.getAllByText(/Electrónica/i).length).toBeGreaterThan(0);
  });

  it('muestra mensaje informativo cuando el tipo es ninguno o no hay datos numéricos', () => {
    render(<ChartVisualizer tipo="ninguno" datos={[]} />);
    expect(screen.getByTestId('chart-placeholder')).toBeInTheDocument();
  });
});

describe('Fase 5 — Componente UI del Paso 8 (Step8Informes.tsx)', () => {
  const informesIniciales: Informe[] = [
    {
      id: 'inf_1',
      titulo: 'Top productos caros',
      pedidoLenguajeNatural: 'Los productos de mayor precio',
      consultaSQL: 'SELECT nombre, precio FROM Producto ORDER BY precio DESC LIMIT 5;',
      explicacionPasoAPaso: 'Ordena de mayor a menor según el precio.',
      tipoGrafico: 'barras',
      columnaEtiquetas: 'nombre',
      columnaValores: 'precio',
      resultado: {
        columnas: ['nombre', 'precio'],
        filas: [
          ['Teclado Mecánico', 82000],
          ['Auriculares Bluetooth', 45000],
        ],
        totalFilas: 2,
        tiempoMs: 3.2,
      },
      fechaCreacion: new Date().toISOString(),
    },
  ];

  it('renderiza el paso con el encabezado unificado, caja conceptual y pestañas de informes', () => {
    const onGenerarInformeConIA = vi.fn();
    const onGuardarOActualizarInforme = vi.fn();
    const onConfirmarInformes = vi.fn();
    const onVolverPaso7 = vi.fn();

    render(
      <Step8Informes
        modelo={MODELO_TIENDA}
        informes={informesIniciales}
        informesConfirmados={false}
        onGenerarInformeConIA={onGenerarInformeConIA}
        onGuardarOActualizarInforme={onGuardarOActualizarInforme}
        onConfirmarInformes={onConfirmarInformes}
        onVolverPaso7={onVolverPaso7}
      />
    );

    expect(screen.getByTestId('step8-container')).toBeInTheDocument();
    expect(
      screen.getByText(/8\. Informes Personalizados y Consultas SELECT/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId('step8-concept-box')).toBeInTheDocument();

    // Verificación de informe activo y validación AST verde
    expect(screen.getByTestId('active-report-container')).toBeInTheDocument();
    expect(screen.getByTestId('ast-sql-valid')).toBeInTheDocument();

    // Tabla de resultados
    expect(screen.getByTestId('report-result-table')).toHaveTextContent('Teclado Mecánico');
    expect(screen.getByTestId('report-result-table')).toHaveTextContent('82000');

    // Botón de confirmación de informes
    const btnConfirmar = screen.getByTestId('btn-confirmar-informes');
    expect(btnConfirmar).not.toBeDisabled();
    fireEvent.click(btnConfirmar);
    expect(onConfirmarInformes).toHaveBeenCalled();
  });
});
