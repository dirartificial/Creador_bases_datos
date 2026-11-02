import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modelo } from '../src/core/schemas';
import {
  generarDDLPostgres,
  validarScriptPostgres,
  mapearTipoConceptualAPostgres,
  generarExplicacionDDLPostgresLocal,
} from '../src/core/ddl/postgres';
import {
  generarDDLMySQL,
  validarScriptMySQL,
  mapearTipoConceptualAMySQL,
  generarExplicacionDDLMySQLLocal,
} from '../src/core/ddl/mysql';
import { PostgresClient } from '../src/core/workers/postgresClient';
import { Step6MotorDDL } from '../src/steps/Step6MotorDDL';

// Modelo de prueba completo con 1:N, N:M y diversos tipos conceptuales
const MODELO_PRUEBA_VETERINARIA: Modelo = {
  entidades: [
    {
      nombre: 'clientes',
      descripcion: 'Personas dueñas de las mascotas atendidas en la veterinaria.',
      atributos: [
        {
          nombre: 'id_cliente',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion: 'Clave primaria autoincremental única.',
        },
        {
          nombre: 'nombre_completo',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Nombre y apellido del cliente.',
        },
        {
          nombre: 'email',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: true,
          esClavePrimaria: false,
          justificacion: 'Correo de contacto único.',
        },
        {
          nombre: 'fecha_registro',
          tipoConceptual: 'fecha',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Fecha de alta.',
        },
      ],
    },
    {
      nombre: 'mascotas',
      descripcion: 'Animales registrados para atención clínica.',
      atributos: [
        {
          nombre: 'id_mascota',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion: 'Clave primaria autoincremental de la mascota.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Nombre de la mascota.',
        },
        {
          nombre: 'especie',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          valoresPermitidos: ['Perro', 'Gato', 'Ave'],
          justificacion: 'Especie del animal.',
        },
        {
          nombre: 'peso_kg',
          tipoConceptual: 'decimal',
          obligatorio: false,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Peso actual en kilogramos.',
        },
        {
          nombre: 'activo',
          tipoConceptual: 'booleano',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Estado de la ficha clínica.',
        },
        {
          nombre: 'id_cliente',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Clave foránea hacia el dueño.',
        },
      ],
    },
    {
      nombre: 'tratamientos',
      descripcion: 'Catálogo de procedimientos médicos aplicables.',
      atributos: [
        {
          nombre: 'id_tratamiento',
          tipoConceptual: 'entero',
          obligatorio: true,
          unico: true,
          esClavePrimaria: true,
          justificacion: 'Clave del tratamiento.',
        },
        {
          nombre: 'nombre',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: true,
          esClavePrimaria: false,
          justificacion: 'Denominación del tratamiento.',
        },
        {
          nombre: 'costo',
          tipoConceptual: 'decimal',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Precio estándar del tratamiento.',
        },
      ],
    },
  ],
  relaciones: [
    {
      origen: 'clientes',
      destino: 'mascotas',
      cardinalidad: '1:N',
      descripcion: 'Un cliente puede poseer varias mascotas.',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: true,
    },
    {
      origen: 'mascotas',
      destino: 'tratamientos',
      cardinalidad: 'N:M',
      descripcion: 'Una mascota puede recibir múltiples tratamientos y viceversa.',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    },
  ],
};

describe('Fase 7 — Generador de DDL para PostgreSQL (postgres.ts)', () => {
  it('mapea correctamente todos los tipos conceptuales a tipos estándar de PostgreSQL', () => {
    expect(mapearTipoConceptualAPostgres('texto')).toBe('VARCHAR(255)');
    expect(mapearTipoConceptualAPostgres('entero')).toBe('INTEGER');
    expect(mapearTipoConceptualAPostgres('decimal')).toBe('NUMERIC(10, 2)');
    expect(mapearTipoConceptualAPostgres('fecha')).toBe('DATE');
    expect(mapearTipoConceptualAPostgres('fecha_hora')).toBe('TIMESTAMP');
    expect(mapearTipoConceptualAPostgres('booleano')).toBe('BOOLEAN');
  });

  it('genera DDL PostgreSQL con SERIAL, NUMERIC, DATE, BOOLEAN, CHECK y claves foráneas nombradas', () => {
    const ddl = generarDDLPostgres(MODELO_PRUEBA_VETERINARIA, {
      incluirComentarios: true,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    // 1. SERIAL PRIMARY KEY para enteros autoincrementales
    expect(ddl).toContain('"id_cliente" SERIAL PRIMARY KEY');
    expect(ddl).toContain('"id_mascota" SERIAL PRIMARY KEY');

    // 2. Tipos nativos de PostgreSQL
    expect(ddl).toContain('"peso_kg" NUMERIC(10, 2)');
    expect(ddl).toContain('"fecha_registro" DATE NOT NULL');
    expect(ddl).toContain('"activo" BOOLEAN NOT NULL');

    // 3. Restricción CHECK de valores permitidos
    expect(ddl).toContain("CHECK (\"especie\" IN ('Perro', 'Gato', 'Ave'))");

    // 4. Clave foránea con restricción nombrada y acción referencial
    expect(ddl).toContain(
      'CONSTRAINT "fk_mascotas_id_cliente" FOREIGN KEY ("id_cliente") REFERENCES "clientes" ("id_cliente") ON DELETE CASCADE ON UPDATE CASCADE'
    );

    // 5. Tabla asociativa intermedia generada automáticamente para la relación N:M
    expect(ddl).toContain('CREATE TABLE "mascotas_tratamientos"');
    expect(ddl).toContain('CONSTRAINT "pk_mascotas_tratamientos" PRIMARY KEY ("id_mascotas", "id_tratamientos")');

    // 6. Comentarios ANSI estándar en PostgreSQL
    expect(ddl).toContain('COMMENT ON TABLE "clientes" IS');
    expect(ddl).toContain('COMMENT ON COLUMN "clientes"."email" IS');

    // 7. Orden topológico: clientes (padre) antes que mascotas (hijo)
    const idxClientes = ddl.indexOf('CREATE TABLE "clientes"');
    const idxMascotas = ddl.indexOf('CREATE TABLE "mascotas"');
    const idxIntermedia = ddl.indexOf('CREATE TABLE "mascotas_tratamientos"');
    expect(idxClientes).toBeLessThan(idxMascotas);
    expect(idxMascotas).toBeLessThan(idxIntermedia);
  });

  it('valida exitosamente el script DDL PostgreSQL generado con el parser AST (node-sql-parser)', () => {
    const ddl = generarDDLPostgres(MODELO_PRUEBA_VETERINARIA);
    const resultado = validarScriptPostgres(ddl);
    expect(resultado.valido).toBe(true);
    expect(resultado.error).toBeUndefined();
  });
});

describe('Fase 7 — Generador de DDL para MySQL (mysql.ts)', () => {
  it('mapea correctamente todos los tipos conceptuales a tipos estándar de MySQL (InnoDB)', () => {
    expect(mapearTipoConceptualAMySQL('texto')).toBe('VARCHAR(255)');
    expect(mapearTipoConceptualAMySQL('entero')).toBe('INT');
    expect(mapearTipoConceptualAMySQL('decimal')).toBe('DECIMAL(10, 2)');
    expect(mapearTipoConceptualAMySQL('fecha')).toBe('DATE');
    expect(mapearTipoConceptualAMySQL('fecha_hora')).toBe('DATETIME');
    expect(mapearTipoConceptualAMySQL('booleano')).toBe('BOOLEAN');
  });

  it('genera DDL MySQL con ENGINE=InnoDB, utf8mb4, AUTO_INCREMENT y FOREIGN_KEY_CHECKS', () => {
    const ddl = generarDDLMySQL(MODELO_PRUEBA_VETERINARIA, {
      incluirComentarios: true,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    });

    // 1. Directivas de protección de claves foráneas
    expect(ddl).toContain('SET FOREIGN_KEY_CHECKS = 0;');
    expect(ddl).toContain('SET FOREIGN_KEY_CHECKS = 1;');

    // 2. AUTO_INCREMENT y PRIMARY KEY en MySQL
    expect(ddl).toContain('`id_cliente` INT NOT NULL AUTO_INCREMENT PRIMARY KEY');

    // 3. Tipos nativos
    expect(ddl).toContain('`peso_kg` DECIMAL(10, 2)');
    expect(ddl).toContain('`activo` BOOLEAN NOT NULL');

    // 4. Motor InnoDB y Charset utf8mb4
    expect(ddl).toContain('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    // 5. Clave foránea con restricción nombrada y acción referencial
    expect(ddl).toContain(
      'CONSTRAINT `fk_mascotas_id_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `clientes` (`id_cliente`) ON DELETE RESTRICT ON UPDATE CASCADE'
    );

    // 6. Tabla asociativa intermedia generada automáticamente
    expect(ddl).toContain('CREATE TABLE `mascotas_tratamientos`');
    expect(ddl).toContain('PRIMARY KEY (`id_mascotas`, `id_tratamientos`)');
  });

  it('valida exitosamente el script DDL MySQL generado con el parser AST (node-sql-parser)', () => {
    const ddl = generarDDLMySQL(MODELO_PRUEBA_VETERINARIA);
    const resultado = validarScriptMySQL(ddl);
    expect(resultado.valido).toBe(true);
    expect(resultado.error).toBeUndefined();
  });
});

describe('Fase 7 — Ejecución Real en el Navegador con PostgreSQL (PGlite)', () => {
  let pgClient: PostgresClient;

  beforeEach(() => {
    pgClient = new PostgresClient();
  });

  it('ejecuta el script DDL generado, crea las tablas en el catálogo y valida la integridad referencial', async () => {
    const ddl = generarDDLPostgres(MODELO_PRUEBA_VETERINARIA);

    // 1. Ejecutar el DDL generado en PGlite (WASM en memoria)
    await pgClient.ejecutarDDL(ddl);

    // 2. Comprobar que las tablas existen en information_schema
    const tablas = await pgClient.obtenerListaTablas();
    expect(tablas).toContain('clientes');
    expect(tablas).toContain('mascotas');
    expect(tablas).toContain('tratamientos');
    expect(tablas).toContain('mascotas_tratamientos');

    // 3. Inserción de datos válida respetando las claves foráneas
    await pgClient.ejecutarConsulta(
      "INSERT INTO clientes (nombre_completo, email, fecha_registro) VALUES ('Carlos Gómez', 'carlos@ejemplo.com', '2026-03-01');"
    );

    await pgClient.ejecutarConsulta(
      "INSERT INTO mascotas (nombre, especie, peso_kg, activo, id_cliente) VALUES ('Bobby', 'Perro', 14.50, true, 1);"
    );

    // 4. Consulta con JOIN
    const resJoin = await pgClient.ejecutarConsulta(
      'SELECT m.nombre AS mascota, c.nombre_completo AS dueno FROM mascotas m JOIN clientes c ON m.id_cliente = c.id_cliente;'
    );
    expect(resJoin.rows).toHaveLength(1);
    expect(resJoin.rows[0].mascota).toBe('Bobby');
    expect(resJoin.rows[0].dueno).toBe('Carlos Gómez');

    // 5. Integridad referencial: rechazar inserción de mascota con cliente inexistente (id_cliente = 999)
    await expect(
      pgClient.ejecutarConsulta(
        "INSERT INTO mascotas (nombre, especie, peso_kg, activo, id_cliente) VALUES ('Michi', 'Gato', 4.2, true, 999);"
      )
    ).rejects.toThrow();

    await pgClient.destruir();
  });
});

describe('Fase 7 — Explicaciones Pedagógicas del Tutor para PostgreSQL y MySQL', () => {
  it('genera explicación deductiva local para PostgreSQL con conceptos de SERIAL y tipos estrictos', () => {
    const explicacion = generarExplicacionDDLPostgresLocal(MODELO_PRUEBA_VETERINARIA);
    expect(explicacion.resumenPedagogico).toMatch(/PostgreSQL/i);
    expect(explicacion.explicacionPorTabla).toHaveLength(3);
    expect(explicacion.observacionesTutor.some((o) => o.includes('SERIAL'))).toBe(true);
    expect(explicacion.observacionesTutor.some((o) => o.includes('PGlite'))).toBe(true);
  });

  it('genera explicación deductiva local para MySQL con conceptos de InnoDB y AUTO_INCREMENT', () => {
    const explicacion = generarExplicacionDDLMySQLLocal(MODELO_PRUEBA_VETERINARIA);
    expect(explicacion.resumenPedagogico).toMatch(/MySQL/i);
    expect(explicacion.explicacionPorTabla).toHaveLength(3);
    expect(explicacion.observacionesTutor.some((o) => o.includes('InnoDB'))).toBe(true);
    expect(explicacion.observacionesTutor.some((o) => o.includes('AUTO_INCREMENT'))).toBe(true);
  });
});

describe('Fase 7 — Componente Interactivo Step6MotorDDL con PostgreSQL y MySQL', () => {
  it('permite cambiar a PostgreSQL y muestra el botón para probar en PGlite', () => {
    const onCambiarMotor = vi.fn();
    render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="postgresql"
        ddlConfirmado={false}
        onCambiarMotor={onCambiarMotor}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={vi.fn()}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    // Muestra el DDL de PostgreSQL
    expect(screen.getByTestId('ddl-code-display')).toHaveTextContent(/SCRIPT DDL DETERMINÍSTICO PARA POSTGRESQL/i);
    expect(screen.getByTestId('ddl-code-display')).toHaveTextContent(/SERIAL PRIMARY KEY/i);

    // Muestra el banner informativo pedagógico de PGlite
    expect(screen.getByTestId('postgres-info-banner')).toBeInTheDocument();
    expect(screen.getByTestId('postgres-info-banner')).toHaveTextContent(/PGlite \(WebAssembly\)/i);

    // Muestra el botón de ejecución en PGlite
    const btnProbarPG = screen.getByTestId('test-postgres-btn');
    expect(btnProbarPG).toBeInTheDocument();
    expect(btnProbarPG).toHaveTextContent(/Probar en PostgreSQL \(PGlite WASM\)/i);
  });

  it('permite cambiar a MySQL y muestra el banner informativo sobre la ejecución estática', () => {
    const onCambiarMotor = vi.fn();
    render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="mysql"
        ddlConfirmado={false}
        onCambiarMotor={onCambiarMotor}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={vi.fn()}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    // Muestra el banner informativo de MySQL
    expect(screen.getByTestId('mysql-info-banner')).toBeInTheDocument();
    expect(screen.getByTestId('mysql-info-banner')).toHaveTextContent(/Modo Script para MySQL \(ENGINE=InnoDB\)/i);

    // Muestra el DDL de MySQL con ENGINE=InnoDB
    expect(screen.getByTestId('ddl-code-display')).toHaveTextContent(/ENGINE=InnoDB/i);
    expect(screen.getByTestId('ddl-code-display')).toHaveTextContent(/AUTO_INCREMENT/i);

    // No debe mostrar el botón de PGlite en MySQL
    expect(screen.queryByTestId('test-postgres-btn')).not.toBeInTheDocument();
  });

  it('ejecuta el DDL en PostgreSQL al hacer clic en "Probar en PostgreSQL (PGlite WASM)" y muestra el resultado en pantalla', async () => {
    render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="postgresql"
        ddlConfirmado={false}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={vi.fn()}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    const btnProbar = screen.getByTestId('test-postgres-btn');
    fireEvent.click(btnProbar);

    await waitFor(() => {
      const resEl = screen.getByTestId('postgres-execution-result');
      expect(resEl).toBeInTheDocument();
      expect(resEl).toHaveTextContent(/inicializada con éxito en el navegador mediante PGlite/i);
    });
  });

  it('ExplicacionDDLSchema normaliza tolerantemente sinónimos de LLMs (resumen, tables, claves, advertencias)', async () => {
    const { ExplicacionDDLSchema } = await import('../src/core/schemas');

    const respuestaLLMConVariaciones = {
      resumen: 'Traducción relacional a SQLite de la base de datos.',
      tablas: [
        {
          table: 'clientes',
          propositoDidactico: 'Entidad que almacena clientes.',
          claves: 'Clave primaria autoincremental id_cliente.',
        },
      ],
      advertenciasBuenasPracticas: [
        'Activar siempre foreign_keys = ON.',
      ],
    };

    const normalizado = ExplicacionDDLSchema.parse(respuestaLLMConVariaciones);
    expect(normalizado.resumenPedagogico).toBe('Traducción relacional a SQLite de la base de datos.');
    expect(normalizado.explicacionPorTabla).toHaveLength(1);
    expect(normalizado.explicacionPorTabla[0].tabla).toBe('clientes');
    expect(normalizado.explicacionPorTabla[0].explicacion).toBe('Entidad que almacena clientes.');
    expect(normalizado.explicacionPorTabla[0].detalleClaves).toBe('Clave primaria autoincremental id_cliente.');
    expect(normalizado.observacionesTutor).toContain('Activar siempre foreign_keys = ON.');
  });

  it('al solicitar la explicación DDL conmuta a la pestaña de explicación y muestra el estado de carga y el resultado', async () => {
    const promesaIA = Promise.resolve();
    const onPedirExplicacionIA = vi.fn().mockImplementation(() => promesaIA);

    const { rerender } = render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="sqlite"
        ddlConfirmado={false}
        cargandoIA={false}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={onPedirExplicacionIA}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    const btnPedir = screen.getByTestId('ask-ai-explanation-btn');
    fireEvent.click(btnPedir);

    expect(onPedirExplicacionIA).toHaveBeenCalled();

    // Mientras carga la IA en la pestaña de explicación, se muestra el indicador visual de carga
    rerender(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="sqlite"
        ddlConfirmado={false}
        cargandoIA={true}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={onPedirExplicacionIA}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    expect(screen.getByTestId('ai-ddl-loading-box')).toBeInTheDocument();
    expect(screen.getByText(/El tutor IA está analizando tu script DDL/i)).toBeInTheDocument();

    // Cuando la explicación se recibe, se renderiza la tarjeta didáctica completa
    const explicacionMock = {
      resumenPedagogico: 'Explicación detallada del esquema SQLite.',
      explicacionPorTabla: [
        {
          tabla: 'clientes',
          explicacion: 'Tabla maestra de clientes.',
          detalleClaves: 'Clave id_cliente.',
        },
      ],
      observacionesTutor: ['Usar PRAGMA foreign_keys = ON;'],
    };

    rerender(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="sqlite"
        ddlConfirmado={false}
        explicacionDDL={explicacionMock}
        cargandoIA={false}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={onPedirExplicacionIA}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    expect(screen.getByTestId('ai-ddl-explanation-card')).toBeInTheDocument();
    expect(screen.getByText('Explicación detallada del esquema SQLite.')).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no consultaste la explicación/i)).not.toBeInTheDocument();
  });
});
