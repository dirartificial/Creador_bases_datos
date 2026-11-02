import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { crearProyectoInicial, Modelo } from '../src/core/schemas';
import {
  generarScriptMongo,
  validarScriptMongo,
  mapearTipoConceptualABSON,
  analizarEmbeberVsReferenciar,
  construirDefinicionesMongo,
  generarDocumentosEjemploMongo,
  generarExplicacionDDLMongoLocal,
} from '../src/core/ddl/mongo';
import { Step6MotorDDL } from '../src/steps/Step6MotorDDL';
import { Step7DatosEjemplo } from '../src/steps/Step7DatosEjemplo';
import { generarPaqueteZip } from '../src/export/zip';
import { unzipSync } from 'fflate';

// Modelo de prueba pedagógico completo con 1:1, 1:N y N:M
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
          justificacion: 'Identificador único del cliente.',
        },
        {
          nombre: 'nombre_completo',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Nombre y apellido.',
        },
        {
          nombre: 'email',
          tipoConceptual: 'texto',
          obligatorio: true,
          unico: true,
          esClavePrimaria: false,
          justificacion: 'Correo electrónico de contacto.',
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
          justificacion: 'Identificador de la mascota.',
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
          justificacion: 'Peso actual en kg.',
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
          justificacion: 'Referencia hacia el dueño.',
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
          justificacion: 'Nombre del tratamiento.',
        },
        {
          nombre: 'costo',
          tipoConceptual: 'decimal',
          obligatorio: true,
          unico: false,
          esClavePrimaria: false,
          justificacion: 'Precio estándar.',
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
      descripcion: 'Una mascota puede recibir varios tratamientos y viceversa.',
      obligatoriaEnOrigen: false,
      obligatoriaEnDestino: false,
    },
  ],
};

describe('Fase 8 — Mapeo de Tipos BSON y Análisis Embeber vs. Referenciar (mongo.ts)', () => {
  it('mapea correctamente todos los tipos conceptuales a tipos nativos BSON', () => {
    expect(mapearTipoConceptualABSON('texto').bsonType).toBe('string');
    expect(mapearTipoConceptualABSON('entero').bsonType).toBe('int');
    expect(mapearTipoConceptualABSON('decimal').bsonType).toBe('double');
    expect(mapearTipoConceptualABSON('fecha').bsonType).toBe('date');
    expect(mapearTipoConceptualABSON('fecha_hora').bsonType).toBe('date');
    expect(mapearTipoConceptualABSON('booleano').bsonType).toBe('bool');
  });

  it('analiza didácticamente cuándo conviene embeber vs referenciar en relaciones del modelo', () => {
    const analisis = analizarEmbeberVsReferenciar(MODELO_PRUEBA_VETERINARIA);
    expect(analisis.length).toBe(2);

    // 1:N entre clientes y mascotas
    const rel1N = analisis.find(
      (a) => a.entidadPrincipal === 'clientes' && a.entidadRelacionada === 'mascotas'
    );
    expect(rel1N).toBeDefined();
    expect(rel1N?.cardinalidad).toBe('1:N');
    expect(rel1N?.estrategiaRecomendada).toBe('referenciar');
    expect(rel1N?.justificacionPedagogica).toContain('16 MB');

    // N:M entre mascotas y tratamientos
    const relNM = analisis.find(
      (a) => a.entidadPrincipal === 'mascotas' && a.entidadRelacionada === 'tratamientos'
    );
    expect(relNM).toBeDefined();
    expect(relNM?.cardinalidad).toBe('N:M');
    expect(relNM?.estrategiaRecomendada).toBe('referenciar');
    expect(relNM?.justificacionPedagogica).toContain('array de referencias');
  });

  it('recomienda embeber cuando una entidad hija tiene naturaleza de detalle o componente dependiente', () => {
    const modeloConDetalle: Modelo = {
      entidades: [
        {
          nombre: 'pedidos',
          descripcion: 'Cabecera de órdenes de compra.',
          atributos: [
            { nombre: 'id_pedido', tipoConceptual: 'entero', obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'PK pedido' },
          ],
        },
        {
          nombre: 'detalles_pedido',
          descripcion: 'Líneas individuales de cada pedido.',
          atributos: [
            { nombre: 'id_detalle', tipoConceptual: 'entero', obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'PK detalle' },
            { nombre: 'producto', tipoConceptual: 'texto', obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre producto' },
            { nombre: 'cantidad', tipoConceptual: 'entero', obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Cantidad pedida' },
          ],
        },
      ],
      relaciones: [
        {
          origen: 'pedidos',
          destino: 'detalles_pedido',
          cardinalidad: '1:N',
          descripcion: 'Cada pedido contiene varios items o detalles.',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    const analisis = analizarEmbeberVsReferenciar(modeloConDetalle);
    expect(analisis[0].estrategiaRecomendada).toBe('embeber');
    expect(analisis[0].justificacionPedagogica).toContain('array de subdocumentos');
  });
});

describe('Fase 8 — Generador Determinístico de Scripts mongosh (mongo.ts)', () => {
  it('construye definiciones intermedias con validadores $jsonSchema e índices sugeridos', () => {
    const colecciones = construirDefinicionesMongo(MODELO_PRUEBA_VETERINARIA);
    expect(colecciones.length).toBe(3);

    const colMascotas = colecciones.find((c) => c.nombre === 'mascotas');
    expect(colMascotas).toBeDefined();

    // Requeridos
    expect(colMascotas?.camposRequeridos).toContain('id_mascota');
    expect(colMascotas?.camposRequeridos).toContain('nombre');
    expect(colMascotas?.camposRequeridos).toContain('activo');

    // Propiedades BSON
    const propEspecie = colMascotas?.propiedades.find((p) => p.nombre === 'especie');
    expect(propEspecie?.bsonType).toBe('string');
    expect(propEspecie?.enumValores).toEqual(['Perro', 'Gato', 'Ave']);

    // Índices
    const idxPK = colMascotas?.indicesSugeridos.find((i) => i.campos.id_mascota === 1);
    expect(idxPK?.unico).toBe(true);

    const idxRef = colMascotas?.indicesSugeridos.find((i) => i.campos.id_cliente === 1);
    expect(idxRef).toBeDefined();
    expect(idxRef?.motivoPedagogico).toContain('$lookup');
  });

  it('genera un script mongosh completo con db.createCollection, $jsonSchema, índices y $lookup', () => {
    const script = generarScriptMongo(MODELO_PRUEBA_VETERINARIA, {
      incluirComentarios: true,
    });

    // 1. Cabecera y selección de DB
    expect(script).toContain('SCRIPT DIDÁCTICO DE CREACIÓN PARA MONGODB');
    expect(script).toContain('const DB_NAME = "db_tutor";');
    expect(script).toContain('dbInstance = db.getSiblingDB(DB_NAME);');

    // 2. Creación de colecciones con $jsonSchema
    expect(script).toContain('dbInstance.createCollection("clientes"');
    expect(script).toContain('dbInstance.createCollection("mascotas"');
    expect(script).toContain('dbInstance.createCollection("tratamientos"');
    expect(script).toContain('"$jsonSchema"');
    expect(script).toContain('validationLevel: "strict"');

    // 3. Creación de índices sugeridos
    expect(script).toContain('dbInstance.clientes.createIndex');
    expect(script).toContain('dbInstance.mascotas.createIndex');

    // 4. Inserción de documentos de ejemplo
    expect(script).toContain('dbInstance.clientes.insertMany');
    expect(script).toContain('dbInstance.mascotas.insertMany');

    // 5. Ejemplo pedagógico de agregación $lookup
    expect(script).toContain('$lookup:');
    expect(script).toContain('from: "clientes"');
    expect(script).toContain('localField: "id_cliente"');
  });

  it('valida exitosamente el script de MongoDB con el validador estático', () => {
    const script = generarScriptMongo(MODELO_PRUEBA_VETERINARIA);
    const resultado = validarScriptMongo(script);
    expect(resultado.valido).toBe(true);
    expect(resultado.totalColecciones).toBe(3);
  });

  it('detecta errores de sintaxis o delimitadores desbalanceados en scripts de MongoDB', () => {
    const scriptInvalido = 'db.createCollection("test", { validator: { $jsonSchema: { bsonType: "object" } };'; // llave sin cerrar
    const res = validarScriptMongo(scriptInvalido);
    expect(res.valido).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('genera documentos de ejemplo en formato JSON puro por colección', () => {
    const docs = generarDocumentosEjemploMongo(MODELO_PRUEBA_VETERINARIA);
    expect(docs.clientes).toBeDefined();
    expect(docs.clientes.length).toBeGreaterThanOrEqual(2);
    expect(docs.mascotas).toBeDefined();
    expect(docs.clientes[0]._id).toBeDefined();
  });

  it('genera una explicación pedagógica didáctica local completa para MongoDB', () => {
    const exp = generarExplicacionDDLMongoLocal(MODELO_PRUEBA_VETERINARIA);
    expect(exp.resumenPedagogico).toContain('MongoDB');
    expect(exp.explicacionPorTabla.length).toBe(3);
    expect(exp.observacionesTutor.some((o) => o.includes('16 MB'))).toBe(true);
    expect(exp.observacionesTutor.some((o) => o.includes('EMBEBER vs. REFERENCIAR'))).toBe(true);
  });
});

describe('Fase 8 — Componente Step6MotorDDL con MongoDB', () => {
  it('renderiza la opción de MongoDB disponible y con etiqueta NoSQL Documental', () => {
    const handleCambiarMotor = vi.fn();
    render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="sqlite"
        ddlConfirmado={false}
        onCambiarMotor={handleCambiarMotor}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={vi.fn()}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    const mongoOption = screen.getByTestId('motor-option-mongodb');
    expect(mongoOption).toBeInTheDocument();
    expect(mongoOption.textContent).toContain('MongoDB');
    expect(mongoOption.textContent).toContain('NoSQL Documental');

    // Al hacer clic, invoca onCambiarMotor con 'mongodb'
    fireEvent.click(mongoOption);
    expect(handleCambiarMotor).toHaveBeenCalledWith('mongodb');
  });

  it('muestra el banner pedagógico de NoSQL y valida el script cuando MongoDB está seleccionado', () => {
    render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="mongodb"
        ddlConfirmado={false}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={vi.fn()}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    // Banner informativo pedagógico
    const banner = screen.getByTestId('mongodb-info-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('Modo NoSQL Documental para MongoDB');
    expect(banner.textContent).toContain('Embeber vs. Referenciar');

    // Validación exitosa de sintaxis y JSON Schema
    const valBadge = screen.getByTestId('ast-validation-success');
    expect(valBadge.textContent).toContain('MONGODB');
    expect(valBadge.textContent).toContain('$jsonSchema');

    // Visor de código muestra llamadas dbInstance.createCollection
    const visorCodigo = screen.getByTestId('ddl-code-display');
    expect(visorCodigo.textContent).toContain('createCollection("clientes"');
    expect(visorCodigo.textContent).toContain('$jsonSchema');

    // Pestaña con etiqueta mongosh
    const tabCodigo = screen.getByTestId('tab-codigo-ddl');
    expect(tabCodigo.textContent).toContain('mongosh (.js)');
  });

  it('permite pedir la explicación del tutor IA para MongoDB y muestra las explicaciones por colección', async () => {
    const handlePedirExp = vi.fn().mockResolvedValue(undefined);
    const explicacionMock = generarExplicacionDDLMongoLocal(MODELO_PRUEBA_VETERINARIA);

    const { rerender } = render(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="mongodb"
        ddlConfirmado={false}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={handlePedirExp}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    const btnPedir = screen.getByTestId('ask-ai-explanation-btn');
    expect(btnPedir.textContent).toContain('Explicar Colecciones y NoSQL con Tutor IA');

    fireEvent.click(btnPedir);
    expect(handlePedirExp).toHaveBeenCalled();

    // Rerenderizar con la explicación generada
    rerender(
      <Step6MotorDDL
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="mongodb"
        ddlConfirmado={false}
        explicacionDDL={explicacionMock}
        onCambiarMotor={vi.fn()}
        onActualizarOpcionesDDL={vi.fn()}
        onPedirExplicacionIA={handlePedirExp}
        onConfirmarDDL={vi.fn()}
        onVolverPaso5={vi.fn()}
      />
    );

    const cardExp = screen.getByTestId('ai-ddl-explanation-card');
    expect(cardExp).toBeInTheDocument();
    expect(cardExp.textContent).toContain('Colección: clientes');
    expect(cardExp.textContent).toContain('Validación y Relaciones:');
  });
});

describe('Fase 8 — Componente Step7DatosEjemplo con MongoDB', () => {
  it('ofrece botón para descargar los datos de ejemplo en formato JSON para MongoDB', () => {
    const datosEjemploMock = {
      resumenDidactico: 'Población coherente de prueba.',
      ordenInsercion: ['clientes'],
      tablas: [
        {
          tabla: 'clientes',
          columnas: ['id_cliente', 'nombre_completo', 'email', 'fecha_registro'],
          filas: [
            {
              id_cliente: 1,
              nombre_completo: 'Carlos Gomez',
              email: 'carlos@test.com',
              fecha_registro: '2025-01-10',
            },
          ],
        },
      ],
    };

    render(
      <Step7DatosEjemplo
        modelo={MODELO_PRUEBA_VETERINARIA}
        motorSeleccionado="mongodb"
        datosEjemplo={datosEjemploMock}
        datosConfirmados={false}
        baseSQLiteGenerada={false}
        onCambiarCantidadFilas={vi.fn()}
        onGenerarDatosConIA={vi.fn()}
        onEjecutarEnSQLite={vi.fn()}
        onDescargarSQLite={vi.fn()}
        onConfirmarDatos={vi.fn()}
        onVolverPaso6={vi.fn()}
      />
    );

    const btnDescargarJSON = screen.getByTestId('btn-descargar-mongo-json');
    expect(btnDescargarJSON).toBeInTheDocument();
    expect(btnDescargarJSON.textContent).toContain('datos_mongodb.json');
  });
});

describe('Fase 8 — Empaquetado de Entregables ZIP con MongoDB (zip.ts)', () => {
  it('incluye scripts/esquema_mongodb.js y datos/datos_mongodb.json dentro del ZIP generado', () => {
    const proyecto = crearProyectoInicial();
    proyecto.descripcionProblema = 'Veterinaria municipal';
    proyecto.modelo = MODELO_PRUEBA_VETERINARIA;
    proyecto.motorSeleccionado = 'mongodb';
    proyecto.datosConfirmados = true;

    const zipBytes = generarPaqueteZip({
      proyecto,
    });

    const desempacado = unzipSync(zipBytes);
    const rutas = Object.keys(desempacado);

    // Debe contener el script mongosh
    expect(rutas).toContain('scripts/esquema_mongodb.js');
    expect(rutas).toContain('scripts/esquema.js');

    // Debe contener documentos JSON de MongoDB
    expect(rutas).toContain('datos/datos_mongodb.json');

    // Verificación del contenido de esquema_mongodb.js
    const decoder = new TextDecoder('utf-8');
    const contenidoScript = decoder.decode(desempacado['scripts/esquema_mongodb.js']);
    expect(contenidoScript).toContain('dbInstance.createCollection');
    expect(contenidoScript).toContain('$jsonSchema');
  });
});
