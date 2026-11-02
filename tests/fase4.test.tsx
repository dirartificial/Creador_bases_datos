import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  generarDDLSQLite,
  mapearTipoConceptualASQLite,
  ordenarTablasTopologicamente,
  validarScriptSQLite,
  construirDefinicionesTablas,
} from '../src/core/ddl/sqlite';
import {
  formatearValorLiteralSQLite,
  generarInsertStatementsSQLite,
  sanitizarValorCSV,
  validarIntegridadReferencialDatos,
} from '../src/core/sampleData';
import { sqliteClient } from '../src/core/workers/sqliteClient';
import { ConjuntoDatosEjemplo, Modelo } from '../src/core/schemas';
import { Step6MotorDDL } from '../src/steps/Step6MotorDDL';
import { Step7DatosEjemplo } from '../src/steps/Step7DatosEjemplo';

// Modelo de prueba: Biblioteca (Autor 1:N Libro, y Libro N:M Categoria)
const MODELO_BIBLIOTECA: Modelo = {
  entidades: [
    {
      nombre: 'Libro',
      descripcion: 'Libros disponibles en el catálogo de la biblioteca',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          esClavePrimaria: true,
          obligatorio: true,
          unico: true,
          justificacion: 'Identificador numérico autoincremental de la fila.',
        },
        {
          nombre: 'titulo',
          tipoConceptual: 'texto',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Título de la obra.',
        },
        {
          nombre: 'id_autor',
          tipoConceptual: 'entero',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Clave foránea apuntando al autor creador del libro.',
        },
        {
          nombre: 'disponible',
          tipoConceptual: 'booleano',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Estado de disponibilidad física.',
        },
      ],
    },
    {
      nombre: 'Autor',
      descripcion: 'Escritores y autoras de las obras',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          esClavePrimaria: true,
          obligatorio: true,
          unico: true,
          justificacion: 'Clave primaria del autor.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          esClavePrimaria: false,
          obligatorio: true,
          unico: false,
          justificacion: 'Nombre completo.',
        },
      ],
    },
    {
      nombre: 'Categoria',
      descripcion: 'Géneros literarios o temas',
      atributos: [
        {
          nombre: 'id',
          tipoConceptual: 'entero',
          esClavePrimaria: true,
          obligatorio: true,
          unico: true,
          justificacion: 'ID de la categoría.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          esClavePrimaria: false,
          obligatorio: true,
          unico: true,
          valoresPermitidos: ['Ficción', 'Historia', 'Ciencia', 'Poesía'],
          justificacion: 'Nombre del género.',
        },
      ],
    },
  ],
  relaciones: [
    {
      origen: 'Autor',
      destino: 'Libro',
      cardinalidad: '1:N',
      descripcion: 'Un autor escribe varios libros',
      obligatoriaEnOrigen: true,
      obligatoriaEnDestino: true,
    },
    {
      origen: 'Libro',
      destino: 'Categoria',
      cardinalidad: 'N:M',
      descripcion: 'Un libro puede pertenecer a varias categorías y una categoría a varios libros',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    },
  ],
};

describe('Fase 4 — DDL Determinístico SQLite (src/core/ddl/sqlite.ts)', () => {
  it('mapea correctamente todos los tipos conceptuales a SQLite 3', () => {
    expect(mapearTipoConceptualASQLite('texto')).toBe('TEXT');
    expect(mapearTipoConceptualASQLite('entero')).toBe('INTEGER');
    expect(mapearTipoConceptualASQLite('decimal')).toBe('REAL');
    expect(mapearTipoConceptualASQLite('fecha')).toBe('TEXT');
    expect(mapearTipoConceptualASQLite('fecha_hora')).toBe('TEXT');
    expect(mapearTipoConceptualASQLite('booleano')).toBe('INTEGER');
  });

  it('construye tablas con claves primarias, autoincrement y claves foráneas', () => {
    const defs = construirDefinicionesTablas(MODELO_BIBLIOTECA, {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    // 3 entidades + 1 tabla intermedia generada automáticamente para Libro_Categoria N:M
    expect(defs.length).toBe(4);

    const tablaLibro = defs.find((t) => t.nombre === 'Libro');
    expect(tablaLibro).toBeDefined();
    expect(tablaLibro!.clavesForaneas.length).toBe(1);
    expect(tablaLibro!.clavesForaneas[0].columnaLocal).toBe('id_autor');
    expect(tablaLibro!.clavesForaneas[0].tablaReferenciada).toBe('Autor');
    expect(tablaLibro!.clavesForaneas[0].onDelete).toBe('CASCADE');

    const colDisponible = tablaLibro!.columnas.find((c) => c.nombre === 'disponible');
    expect(colDisponible?.checkExpr).toBe('"disponible" IN (0, 1)');

    const tablaCat = defs.find((t) => t.nombre === 'Categoria');
    const colNombreCat = tablaCat!.columnas.find((c) => c.nombre === 'nombre');
    expect(colNombreCat?.checkExpr).toContain("'Ficción'");
    expect(colNombreCat?.unico).toBe(true);
  });

  it('ordena las tablas topológicamente (padres antes que hijos)', () => {
    const defs = construirDefinicionesTablas(MODELO_BIBLIOTECA);
    const { tablasOrdenadas, hayCiclo } = ordenarTablasTopologicamente(defs);

    expect(hayCiclo).toBe(false);

    const idxAutor = tablasOrdenadas.findIndex((t) => t.nombre === 'Autor');
    const idxLibro = tablasOrdenadas.findIndex((t) => t.nombre === 'Libro');
    const idxIntermedia = tablasOrdenadas.findIndex((t) => t.nombre === 'Libro_Categoria');

    // Autor debe crearse antes que Libro
    expect(idxAutor).toBeLessThan(idxLibro);
    // Libro y Categoria deben crearse antes que la tabla asociativa Libro_Categoria
    expect(idxLibro).toBeLessThan(idxIntermedia);
  });

  it('genera un script DDL SQLite válido y activa PRAGMA foreign_keys = ON', () => {
    const ddl = generarDDLSQLite(MODELO_BIBLIOTECA, {
      habilitarClavesForaneas: true,
      incluirComentarios: true,
    });

    expect(ddl).toContain('PRAGMA foreign_keys = ON;');
    expect(ddl).toContain('CREATE TABLE "Autor"');
    expect(ddl).toContain('CREATE TABLE "Libro"');
    expect(ddl).toContain('FOREIGN KEY ("id_autor") REFERENCES "Autor" ("id") ON DELETE CASCADE');
    expect(ddl).toContain('CREATE TABLE "Libro_Categoria"');

    // Validar sintaxis con el parser AST (node-sql-parser)
    const ast = validarScriptSQLite(ddl);
    expect(ast.valido).toBe(true);
  });

  it('detecta errores de sintaxis en scripts DDL no válidos', () => {
    const ddlInvalido = 'CREATE TABLE usuarios ( id INT PRIMARY KEY,, nombre TEXT );';
    const ast = validarScriptSQLite(ddlInvalido);
    expect(ast.valido).toBe(false);
    expect(ast.error).toBeDefined();
  });
});

describe('Fase 4 — Datos de Ejemplo e Integridad (src/core/sampleData.ts)', () => {
  it('sanitiza valores CSV protegiendo contra inyección de fórmulas', () => {
    expect(sanitizarValorCSV('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizarValorCSV('+12345')).toBe("'+12345");
    expect(sanitizarValorCSV('-CMD|')).toBe("'-CMD|");
    expect(sanitizarValorCSV('@ALERT')).toBe("'@ALERT");
    expect(sanitizarValorCSV('\tTAB')).toBe("'\tTAB");
    expect(sanitizarValorCSV('Gabriel García Márquez')).toBe('Gabriel García Márquez');
    expect(sanitizarValorCSV(123)).toBe('123');
    expect(sanitizarValorCSV(null)).toBe('');
  });

  it('formatea literales SQLite correctamente', () => {
    expect(formatearValorLiteralSQLite("O'Reilly")).toBe("'O''Reilly'");
    expect(formatearValorLiteralSQLite(42)).toBe('42');
    expect(formatearValorLiteralSQLite(true)).toBe('1');
    expect(formatearValorLiteralSQLite(false)).toBe('0');
    expect(formatearValorLiteralSQLite(null)).toBe('NULL');
  });

  it('valida la integridad referencial y detecta violaciones de claves foráneas', () => {
    const datosValidos: ConjuntoDatosEjemplo = {
      ordenInsercion: ['Autor', 'Categoria', 'Libro', 'Libro_Categoria'],
      resumenDidactico: 'Datos de prueba coherentes para una biblioteca escolar.',
      tablas: [
        {
          tabla: 'Autor',
          columnas: ['id', 'nombre'],
          filas: [
            { id: 1, nombre: 'Jorge Luis Borges' },
            { id: 2, nombre: 'Julio Cortázar' },
          ],
        },
        {
          tabla: 'Categoria',
          columnas: ['id', 'nombre'],
          filas: [
            { id: 10, nombre: 'Ficción' },
            { id: 20, nombre: 'Poesía' },
          ],
        },
        {
          tabla: 'Libro',
          columnas: ['id', 'titulo', 'id_autor', 'disponible'],
          filas: [
            { id: 101, titulo: 'Ficciones', id_autor: 1, disponible: 1 },
            { id: 102, titulo: 'Rayuela', id_autor: 2, disponible: 1 },
          ],
        },
        {
          tabla: 'Libro_Categoria',
          columnas: ['id_libro', 'id_categoria'],
          filas: [
            { id_libro: 101, id_categoria: 10 },
            { id_libro: 102, id_categoria: 10 },
          ],
        },
      ],
    };

    const resValido = validarIntegridadReferencialDatos(datosValidos, MODELO_BIBLIOTECA);
    expect(resValido.valido).toBe(true);
    expect(resValido.errores).toHaveLength(0);

    // Corromper una clave foránea (apuntar a autor inexistente id=99)
    const datosInvalidos: ConjuntoDatosEjemplo = {
      ...datosValidos,
      tablas: datosValidos.tablas.map((t) => {
        if (t.tabla === 'Libro') {
          return {
            ...t,
            filas: [{ id: 101, titulo: 'Libro Huérfano', id_autor: 99, disponible: 1 }],
          };
        }
        return t;
      }),
    };

    const resInvalido = validarIntegridadReferencialDatos(datosInvalidos, MODELO_BIBLIOTECA);
    expect(resInvalido.valido).toBe(false);
    expect(resInvalido.errores[0]).toContain('la clave foránea "id_autor" tiene el valor "99"');
  });

  it('genera sentencias INSERT INTO en el orden topológico adecuado', () => {
    const datos: ConjuntoDatosEjemplo = {
      ordenInsercion: ['Autor', 'Libro'],
      resumenDidactico: 'Inserción básica',
      tablas: [
        {
          tabla: 'Autor',
          columnas: ['id', 'nombre'],
          filas: [{ id: 1, nombre: 'Borges' }],
        },
        {
          tabla: 'Libro',
          columnas: ['id', 'titulo', 'id_autor'],
          filas: [{ id: 10, titulo: 'El Aleph', id_autor: 1 }],
        },
      ],
    };

    const inserts = generarInsertStatementsSQLite(datos);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toBe('INSERT INTO "Autor" ("id", "nombre") VALUES (1, \'Borges\');');
    expect(inserts[1]).toBe('INSERT INTO "Libro" ("id", "titulo", "id_autor") VALUES (10, \'El Aleph\', 1);');
  });
});

describe('Fase 4 — Ejecución Real en SQLite WASM (src/core/workers/sqliteClient.ts)', () => {
  beforeEach(async () => {
    await sqliteClient.reiniciar();
  });

  it('ejecuta DDL, inserta datos, consulta filas y exporta archivo binario .sqlite', async () => {
    const ddl = generarDDLSQLite(MODELO_BIBLIOTECA);
    await sqliteClient.ejecutarDDL(ddl);

    const inserts = [
      'INSERT INTO "Autor" ("id", "nombre") VALUES (1, \'Silvina Ocampo\');',
      'INSERT INTO "Libro" ("id", "titulo", "id_autor", "disponible") VALUES (100, \'La furia\', 1, 1);',
    ];

    const insertadas = await sqliteClient.insertarDatos(inserts);
    expect(insertadas).toBe(2);

    // Consulta con SELECT y JOIN
    const res = await sqliteClient.ejecutarConsulta(
      'SELECT "Libro"."titulo", "Autor"."nombre" FROM "Libro" JOIN "Autor" ON "Libro"."id_autor" = "Autor"."id";'
    );

    expect(res.length).toBeGreaterThan(0);
    expect(res[0].columns).toEqual(['titulo', 'nombre']);
    expect(res[0].values).toEqual([['La furia', 'Silvina Ocampo']]);

    // Resumen de tablas
    const resumen = await sqliteClient.obtenerResumenTablas();
    const resumenAutor = resumen.find((r) => r.nombre === 'Autor');
    const resumenLibro = resumen.find((r) => r.nombre === 'Libro');
    expect(resumenAutor?.totalFilas).toBe(1);
    expect(resumenLibro?.totalFilas).toBe(1);

    // Exportar archivo .sqlite binario
    const binario = await sqliteClient.exportarBinario();
    expect(binario).toBeInstanceOf(Uint8Array);
    expect(binario.length).toBeGreaterThan(0);

    // Header mágico estándar de base de datos SQLite ("SQLite format 3\0")
    const headerEsperado = 'SQLite format 3\0';
    const headerObtenido = new TextDecoder('utf-8').decode(binario.slice(0, 16));
    expect(headerObtenido).toBe(headerEsperado);
  });

  it('rechaza inserciones que violan la integridad de claves foráneas con PRAGMA foreign_keys = ON', async () => {
    const ddl = generarDDLSQLite(MODELO_BIBLIOTECA);
    await sqliteClient.ejecutarDDL(ddl);

    // Intentar insertar un libro con id_autor = 999 inexistente
    await expect(
      sqliteClient.insertarDatos([
        'INSERT INTO "Libro" ("id", "titulo", "id_autor", "disponible") VALUES (200, \'Libro Fantasma\', 999, 1);',
      ])
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('Fase 4 — Componentes UI (Step6MotorDDL y Step7DatosEjemplo)', () => {
  it('Step6MotorDDL renderiza el selector de motor con SQLite activo y valida el DDL', () => {
    const onConfirmarDDL = vi.fn();
    const onVolverPaso5 = vi.fn();
    const onCambiarMotor = vi.fn();
    const onActualizarOpcionesDDL = vi.fn();
    const onPedirExplicacionIA = vi.fn();

    render(
      <Step6MotorDDL
        modelo={MODELO_BIBLIOTECA}
        motorSeleccionado="sqlite"
        ddlConfirmado={false}
        onConfirmarDDL={onConfirmarDDL}
        onVolverPaso5={onVolverPaso5}
        onCambiarMotor={onCambiarMotor}
        onActualizarOpcionesDDL={onActualizarOpcionesDDL}
        onPedirExplicacionIA={onPedirExplicacionIA}
      />
    );

    // Contenedor del paso y encabezado
    expect(screen.getByTestId('step6-container')).toBeInTheDocument();
    expect(screen.getByText(/6\. Motor de Base de Datos y Generación de DDL/i)).toBeInTheDocument();
    expect(screen.getByTestId('step6-concept-box')).toBeInTheDocument();

    // Motor SQLite activo
    const motorSqlite = screen.getByTestId('motor-option-sqlite');
    expect(motorSqlite).toBeInTheDocument();
    expect(motorSqlite).toHaveAttribute('aria-pressed', 'true');

    // Validación AST en verde
    expect(screen.getByTestId('ast-validation-success')).toBeInTheDocument();

    // Código DDL mostrado
    expect(screen.getByTestId('ddl-code-display')).toHaveTextContent('CREATE TABLE "Autor"');

    // Botón confirmar DDL
    const btnConfirmar = screen.getByTestId('btn-confirmar-ddl');
    fireEvent.click(btnConfirmar);
    expect(onConfirmarDDL).toHaveBeenCalled();
  });

  it('Step7DatosEjemplo permite seleccionar cantidad de filas, visualiza tablas y ejecuta en SQLite', async () => {
    const onGenerarDatosConIA = vi.fn();
    const onEjecutarEnSQLite = vi.fn();
    const onDescargarSQLite = vi.fn();
    const onConfirmarDatos = vi.fn();
    const onVolverPaso6 = vi.fn();
    const onCambiarCantidadFilas = vi.fn();

    const datosMock: ConjuntoDatosEjemplo = {
      ordenInsercion: ['Autor', 'Libro'],
      resumenDidactico: 'Datos de prueba didácticos para la biblioteca',
      tablas: [
        {
          tabla: 'Autor',
          columnas: ['id', 'nombre'],
          filas: [
            { id: 1, nombre: 'Alfonsina Storni' },
            { id: 2, nombre: 'Roberto Arlt' },
          ],
        },
        {
          tabla: 'Libro',
          columnas: ['id', 'titulo', 'id_autor'],
          filas: [
            { id: 10, titulo: 'El juguete rabioso', id_autor: 2 },
          ],
        },
      ],
    };

    render(
      <Step7DatosEjemplo
        modelo={MODELO_BIBLIOTECA}
        ddlGenerado={generarDDLSQLite(MODELO_BIBLIOTECA)}
        cantidadFilas={3}
        datosEjemplo={datosMock}
        datosConfirmados={false}
        baseSQLiteGenerada={true}
        onCambiarCantidadFilas={onCambiarCantidadFilas}
        onGenerarDatosConIA={onGenerarDatosConIA}
        onEjecutarEnSQLite={onEjecutarEnSQLite}
        onDescargarSQLite={onDescargarSQLite}
        onConfirmarDatos={onConfirmarDatos}
        onVolverPaso6={onVolverPaso6}
      />
    );

    // Contenedor del paso y encabezado
    expect(screen.getByTestId('step7-container')).toBeInTheDocument();
    expect(screen.getByText(/7\. Datos de Ejemplo y Ejecución Real en SQLite/i)).toBeInTheDocument();
    expect(screen.getByTestId('step7-concept-box')).toBeInTheDocument();

    // Integridad referencial verificada
    expect(screen.getByTestId('referential-integrity-valid')).toBeInTheDocument();

    // Tabla interactiva de datos
    expect(screen.getByTestId('sample-data-table')).toHaveTextContent('Alfonsina Storni');

    // Cambiar a la pestaña de Libro
    const tabLibro = screen.getByTestId('tab-table-Libro');
    fireEvent.click(tabLibro);
    expect(screen.getByTestId('sample-data-table')).toHaveTextContent('El juguete rabioso');

    // Ejecutar en SQLite y descargar
    const btnDescargarSQLite = screen.getByTestId('btn-descargar-sqlite');
    expect(btnDescargarSQLite).not.toBeDisabled();
    fireEvent.click(btnDescargarSQLite);
    expect(onDescargarSQLite).toHaveBeenCalled();

    // Confirmar datos
    const btnConfirmar = screen.getByTestId('btn-confirmar-datos');
    fireEvent.click(btnConfirmar);
    expect(onConfirmarDatos).toHaveBeenCalled();
  });
});
