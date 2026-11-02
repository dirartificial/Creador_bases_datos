import { ProyectoEstado, crearProyectoInicial } from './schemas';
import { generarDDLSQLite } from './ddl/sqlite';
import { generarAnalisisResumidoFallback } from '../export/analisis';

export interface PresetProyecto {
  id: 'biblioteca' | 'veterinaria' | 'tienda';
  titulo: string;
  emoji: string;
  icono?: string;
  descripcionCorta: string;
  promptInicial: string;
  generarProyectoCompleto: () => ProyectoEstado;
}

export const PRESET_BIBLIOTECA: PresetProyecto = {
  id: 'biblioteca',
  titulo: 'Biblioteca Escolar',
  emoji: '📚',
  icono: '📚',
  descripcionCorta: 'Gestión de libros, autores, socios (alumnos/docentes) y préstamos de ejemplares.',
  promptInicial:
    'Quiero una base de datos para una biblioteca escolar que administra catálogo de libros, autores, socios registrados (alumnos y docentes) y el registro de préstamos y devoluciones de ejemplares.',
  generarProyectoCompleto: () => {
    const modelo = {
      entidades: [
        {
          nombre: 'autores',
          descripcion: 'Escritores de las obras bibliográficas.',
          atributos: [
            { nombre: 'id_autor', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Identificador autoincremental del autor.' },
            { nombre: 'nombre_completo', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre y apellido del autor.' },
            { nombre: 'nacionalidad', tipoConceptual: 'texto' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'País de origen.' },
          ],
        },
        {
          nombre: 'socios',
          descripcion: 'Alumnos y docentes habilitados para retirar libros.',
          atributos: [
            { nombre: 'id_socio', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Número de credencial del socio.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre del socio.' },
            { nombre: 'email', tipoConceptual: 'texto' as const, obligatorio: true, unico: true, esClavePrimaria: false, justificacion: 'Correo de contacto único.' },
            { nombre: 'tipo_socio', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, valoresPermitidos: ['Alumno', 'Docente'], justificacion: 'Categoría institucional del socio.' },
          ],
        },
        {
          nombre: 'libros',
          descripcion: 'Títulos disponibles en el catálogo.',
          atributos: [
            { nombre: 'id_libro', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Clave única del libro.' },
            { nombre: 'titulo', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Título de la obra.' },
            { nombre: 'genero', tipoConceptual: 'texto' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'Género literario.' },
            { nombre: 'anio_publicacion', tipoConceptual: 'entero' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'Año de edición.' },
            { nombre: 'id_autor', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK hacia el autor que escribió el libro.' },
          ],
        },
        {
          nombre: 'prestamos',
          descripcion: 'Registro de retiro y devolución de libros.',
          atributos: [
            { nombre: 'id_prestamo', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Número de comprobante de préstamo.' },
            { nombre: 'fecha_prestamo', tipoConceptual: 'fecha' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Fecha en que se retiró el libro.' },
            { nombre: 'fecha_devolucion', tipoConceptual: 'fecha' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'Fecha efectiva de devolución.' },
            { nombre: 'id_socio', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK al socio que solicitó el libro.' },
            { nombre: 'id_libro', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK al libro prestado.' },
          ],
        },
      ],
      relaciones: [
        {
          origen: 'autores',
          destino: 'libros',
          cardinalidad: '1:N' as const,
          descripcion: 'Un autor puede escribir varios libros.',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
        {
          origen: 'socios',
          destino: 'prestamos',
          cardinalidad: '1:N' as const,
          descripcion: 'Un socio puede solicitar múltiples préstamos.',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
        {
          origen: 'libros',
          destino: 'prestamos',
          cardinalidad: '1:N' as const,
          descripcion: 'Un libro puede ser prestado en distintas fechas.',
          obligatoriaEnOrigen: false,
          obligatoriaEnDestino: true,
        },
      ],
    };

    const ddl = generarDDLSQLite(modelo);

    const proyectoBase: ProyectoEstado = {
      ...crearProyectoInicial(),
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 6,
      descripcionProblema: PRESET_BIBLIOTECA.promptInicial,
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: true,
      diagramaConfirmado: true,
      ddlConfirmado: true,
      datosConfirmados: true,
      informesConfirmados: true,
      baseSQLiteGenerada: true,
      motorSeleccionado: 'sqlite',
      modelo,
      ddlGenerado: ddl,
      bitacora: [
        { paso: 1, fecha: new Date().toISOString(), descripcion: 'Cargó el ejemplo precargado de Biblioteca Escolar.', origen: 'estudiante' },
        { paso: 3, fecha: new Date().toISOString(), descripcion: 'Confirmó el modelo conceptual con 4 entidades normalizadas.', origen: 'estudiante' },
        { paso: 4, fecha: new Date().toISOString(), descripcion: 'Verificó integridad de claves foráneas e integridad referencial.', origen: 'ia_aceptada' },
      ],
      datosEjemplo: {
        resumenDidactico: 'Datos de prueba coherentes para socios, autores, libros y préstamos.',
        ordenInsercion: ['autores', 'socios', 'libros', 'prestamos'],
        tablas: [
          {
            tabla: 'autores',
            columnas: ['id_autor', 'nombre_completo', 'nacionalidad'],
            filas: [
              { id_autor: 1, nombre_completo: 'Gabriel García Márquez', nacionalidad: 'Colombiana' },
              { id_autor: 2, nombre_completo: 'Jorge Luis Borges', nacionalidad: 'Argentina' },
              { id_autor: 3, nombre_completo: 'Isabel Allende', nacionalidad: 'Chilena' },
            ],
          },
          {
            tabla: 'socios',
            columnas: ['id_socio', 'nombre', 'email', 'tipo_socio'],
            filas: [
              { id_socio: 1, nombre: 'Ana Gómez', email: 'ana@colegio.edu.ar', tipo_socio: 'Alumno' },
              { id_socio: 2, nombre: 'Martín Pérez', email: 'martin@colegio.edu.ar', tipo_socio: 'Alumno' },
              { id_socio: 3, nombre: 'Prof. Laura Rossi', email: 'laura@colegio.edu.ar', tipo_socio: 'Docente' },
            ],
          },
          {
            tabla: 'libros',
            columnas: ['id_libro', 'titulo', 'genero', 'anio_publicacion', 'id_autor'],
            filas: [
              { id_libro: 1, titulo: 'Cien Años de Soledad', genero: 'Realismo Mágico', anio_publicacion: 1967, id_autor: 1 },
              { id_libro: 2, titulo: 'Ficciones', genero: 'Cuentos', anio_publicacion: 1944, id_autor: 2 },
              { id_libro: 3, titulo: 'La Casa de los Espíritus', genero: 'Novela', anio_publicacion: 1982, id_autor: 3 },
            ],
          },
          {
            tabla: 'prestamos',
            columnas: ['id_prestamo', 'fecha_prestamo', 'fecha_devolucion', 'id_socio', 'id_libro'],
            filas: [
              { id_prestamo: 1, fecha_prestamo: '2025-03-01', fecha_devolucion: '2025-03-10', id_socio: 1, id_libro: 1 },
              { id_prestamo: 2, fecha_prestamo: '2025-03-05', fecha_devolucion: null, id_socio: 2, id_libro: 2 },
              { id_prestamo: 3, fecha_prestamo: '2025-03-12', fecha_devolucion: '2025-03-20', id_socio: 3, id_libro: 3 },
            ],
          },
        ],
      },
      informes: [
        {
          id: 'inf_libros_autores',
          titulo: 'Catálogo de Libros con Nombre de su Autor',
          pedidoLenguajeNatural: 'Listar todos los libros con el nombre de su autor correspondiente.',
          consultaSQL: 'SELECT l.titulo, a.nombre_completo AS autor, l.genero FROM libros l JOIN autores a ON l.id_autor = a.id_autor ORDER BY l.titulo ASC;',
          explicacionPasoAPaso: 'Combina libros y autores mediante un JOIN sobre la clave foránea id_autor.',
          tipoGrafico: 'barras',
          fechaCreacion: new Date().toISOString(),
          resultado: {
            columnas: ['titulo', 'autor', 'genero'],
            filas: [
              ['Cien Años de Soledad', 'Gabriel García Márquez', 'Realismo Mágico'],
              ['Ficciones', 'Jorge Luis Borges', 'Cuentos'],
              ['La Casa de los Espíritus', 'Isabel Allende', 'Novela'],
            ],
            totalFilas: 3,
            tiempoMs: 2,
          },
        },
      ],
    };
    proyectoBase.analisisResumido = generarAnalisisResumidoFallback(proyectoBase);
    return proyectoBase;
  },
};

export const PRESET_VETERINARIA: PresetProyecto = {
  id: 'veterinaria',
  titulo: 'Clínica Veterinaria',
  emoji: '🐾',
  icono: '🐾',
  descripcionCorta: 'Control de clientes (dueños), mascotas, fichas clínicas y tratamientos médicos.',
  promptInicial:
    'Quiero una base de datos para una veterinaria que registra clientes (dueños de mascotas), fichas de los animales atendidos y tratamientos médicos aplicados.',
  generarProyectoCompleto: () => {
    const modelo = {
      entidades: [
        {
          nombre: 'clientes',
          descripcion: 'Dueños de las mascotas atendidas en el consultorio.',
          atributos: [
            { nombre: 'id_cliente', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Identificador del cliente.' },
            { nombre: 'nombre_completo', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre y apellido.' },
            { nombre: 'telefono', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Teléfono de urgencias.' },
            { nombre: 'email', tipoConceptual: 'texto' as const, obligatorio: false, unico: true, esClavePrimaria: false, justificacion: 'Correo de contacto.' },
          ],
        },
        {
          nombre: 'mascotas',
          descripcion: 'Ficha clínica de cada animal.',
          atributos: [
            { nombre: 'id_mascota', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Número de historia clínica.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre de la mascota.' },
            { nombre: 'especie', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, valoresPermitidos: ['Canino', 'Felino', 'Ave'], justificacion: 'Especie del animal.' },
            { nombre: 'peso_kg', tipoConceptual: 'decimal' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'Peso actual en kilogramos.' },
            { nombre: 'id_cliente', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK hacia el dueño.' },
          ],
        },
        {
          nombre: 'tratamientos',
          descripcion: 'Catálogo de vacunas y procedimientos.',
          atributos: [
            { nombre: 'id_tratamiento', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Código de tratamiento.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: true, esClavePrimaria: false, justificacion: 'Nombre del procedimiento o vacuna.' },
            { nombre: 'costo', tipoConceptual: 'decimal' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Importe del tratamiento.' },
          ],
        },
        {
          nombre: 'atenciones',
          descripcion: 'Registro de aplicaciones médicas a las mascotas.',
          atributos: [
            { nombre: 'id_atencion', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Comprobante de atención.' },
            { nombre: 'fecha', tipoConceptual: 'fecha' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Día de la consulta.' },
            { nombre: 'observaciones', tipoConceptual: 'texto' as const, obligatorio: false, unico: false, esClavePrimaria: false, justificacion: 'Diagnóstico veterinario.' },
            { nombre: 'id_mascota', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK a la mascota paciente.' },
            { nombre: 'id_tratamiento', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK al tratamiento realizado.' },
          ],
        },
      ],
      relaciones: [
        { origen: 'clientes', destino: 'mascotas', cardinalidad: '1:N' as const, descripcion: 'Un cliente tiene muchas mascotas.', obligatoriaEnOrigen: false, obligatoriaEnDestino: true },
        { origen: 'mascotas', destino: 'atenciones', cardinalidad: '1:N' as const, descripcion: 'Una mascota recibe múltiples atenciones.', obligatoriaEnOrigen: false, obligatoriaEnDestino: true },
        { origen: 'tratamientos', destino: 'atenciones', cardinalidad: '1:N' as const, descripcion: 'Un tratamiento puede aplicarse en muchas atenciones.', obligatoriaEnOrigen: false, obligatoriaEnDestino: true },
      ],
    };

    const ddl = generarDDLSQLite(modelo);

    const proyectoBase: ProyectoEstado = {
      ...crearProyectoInicial(),
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 6,
      descripcionProblema: PRESET_VETERINARIA.promptInicial,
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: true,
      diagramaConfirmado: true,
      ddlConfirmado: true,
      datosConfirmados: true,
      informesConfirmados: true,
      baseSQLiteGenerada: true,
      motorSeleccionado: 'sqlite',
      modelo,
      ddlGenerado: ddl,
      bitacora: [
        { paso: 1, fecha: new Date().toISOString(), descripcion: 'Cargó el ejemplo precargado de Clínica Veterinaria.', origen: 'estudiante' },
      ],
      datosEjemplo: {
        resumenDidactico: 'Historias clínicas, dueños y tratamientos veterinarios reales.',
        ordenInsercion: ['clientes', 'mascotas', 'tratamientos', 'atenciones'],
        tablas: [
          {
            tabla: 'clientes',
            columnas: ['id_cliente', 'nombre_completo', 'telefono', 'email'],
            filas: [
              { id_cliente: 1, nombre_completo: 'Lucía Fernández', telefono: '11-4567-8901', email: 'lucia@email.com' },
              { id_cliente: 2, nombre_completo: 'Carlos Méndez', telefono: '11-8901-2345', email: 'carlos@email.com' },
            ],
          },
          {
            tabla: 'mascotas',
            columnas: ['id_mascota', 'nombre', 'especie', 'peso_kg', 'id_cliente'],
            filas: [
              { id_mascota: 1, nombre: 'Thor', especie: 'Canino', peso_kg: 24.5, id_cliente: 1 },
              { id_mascota: 2, nombre: 'Mimi', especie: 'Felino', peso_kg: 4.2, id_cliente: 1 },
              { id_mascota: 3, nombre: 'Rocco', especie: 'Canino', peso_kg: 18.0, id_cliente: 2 },
            ],
          },
          {
            tabla: 'tratamientos',
            columnas: ['id_tratamiento', 'nombre', 'costo'],
            filas: [
              { id_tratamiento: 1, nombre: 'Vacunación Antirrábica', costo: 15000 },
              { id_tratamiento: 2, nombre: 'Desparasitación Interna', costo: 8500 },
              { id_tratamiento: 3, nombre: 'Control Clínico General', costo: 12000 },
            ],
          },
          {
            tabla: 'atenciones',
            columnas: ['id_atencion', 'fecha', 'observaciones', 'id_mascota', 'id_tratamiento'],
            filas: [
              { id_atencion: 1, fecha: '2025-02-10', observaciones: 'Vacuna anual sin reacciones', id_mascota: 1, id_tratamiento: 1 },
              { id_atencion: 2, fecha: '2025-02-14', observaciones: 'Revisión periódica óptima', id_mascota: 2, id_tratamiento: 3 },
            ],
          },
        ],
      },
      informes: [
        {
          id: 'inf_mascotas_duenos',
          titulo: 'Mascotas por Dueño y Especie',
          pedidoLenguajeNatural: 'Listar las mascotas con el nombre de su dueño y su especie.',
          consultaSQL: 'SELECT m.nombre AS mascota, m.especie, c.nombre_completo AS dueno, c.telefono FROM mascotas m JOIN clientes c ON m.id_cliente = c.id_cliente ORDER BY c.nombre_completo ASC;',
          explicacionPasoAPaso: 'Combina mascotas y clientes mediante un JOIN sobre id_cliente.',
          tipoGrafico: 'barras',
          fechaCreacion: new Date().toISOString(),
          resultado: {
            columnas: ['mascota', 'especie', 'dueno', 'telefono'],
            filas: [
              ['Thor', 'Canino', 'Lucía Fernández', '11-4567-8901'],
              ['Mimi', 'Felino', 'Lucía Fernández', '11-4567-8901'],
              ['Rocco', 'Canino', 'Carlos Méndez', '11-8901-2345'],
            ],
            totalFilas: 3,
            tiempoMs: 2,
          },
        },
      ],
    };
    proyectoBase.analisisResumido = generarAnalisisResumidoFallback(proyectoBase);
    return proyectoBase;
  },
};

export const PRESET_TIENDA: PresetProyecto = {
  id: 'tienda',
  titulo: 'Tienda de Comercio',
  emoji: '🛍️',
  icono: '🛍️',
  descripcionCorta: 'Catálogo de productos por categoría, clientes y pedidos con detalles de venta.',
  promptInicial:
    'Quiero una base de datos para una tienda de comercio que gestiona categorías de productos, catálogo de artículos, clientes y órdenes de compra con sus ítems.',
  generarProyectoCompleto: () => {
    const modelo = {
      entidades: [
        {
          nombre: 'categorias',
          descripcion: 'Clasificación de productos.',
          atributos: [
            { nombre: 'id_categoria', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Identificador de categoría.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: true, esClavePrimaria: false, justificacion: 'Nombre de la categoría.' },
          ],
        },
        {
          nombre: 'productos',
          descripcion: 'Artículos a la venta.',
          atributos: [
            { nombre: 'id_producto', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Código de producto.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Denominación del producto.' },
            { nombre: 'precio', tipoConceptual: 'decimal' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Precio unitario.' },
            { nombre: 'stock', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Unidades en depósito.' },
            { nombre: 'id_categoria', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK a la categoría.' },
          ],
        },
        {
          nombre: 'clientes',
          descripcion: 'Compradores registrados.',
          atributos: [
            { nombre: 'id_cliente', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Identificador del cliente.' },
            { nombre: 'nombre', tipoConceptual: 'texto' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Nombre del comprador.' },
            { nombre: 'email', tipoConceptual: 'texto' as const, obligatorio: true, unico: true, esClavePrimaria: false, justificacion: 'Correo electrónico.' },
          ],
        },
        {
          nombre: 'pedidos',
          descripcion: 'Órdenes de compra generadas.',
          atributos: [
            { nombre: 'id_pedido', tipoConceptual: 'entero' as const, obligatorio: true, unico: true, esClavePrimaria: true, justificacion: 'Número de factura u orden.' },
            { nombre: 'fecha', tipoConceptual: 'fecha' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Fecha de la compra.' },
            { nombre: 'total', tipoConceptual: 'decimal' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'Monto total pagado.' },
            { nombre: 'id_cliente', tipoConceptual: 'entero' as const, obligatorio: true, unico: false, esClavePrimaria: false, justificacion: 'FK al cliente comprador.' },
          ],
        },
      ],
      relaciones: [
        { origen: 'categorias', destino: 'productos', cardinalidad: '1:N' as const, descripcion: 'Una categoría contiene varios productos.', obligatoriaEnOrigen: false, obligatoriaEnDestino: true },
        { origen: 'clientes', destino: 'pedidos', cardinalidad: '1:N' as const, descripcion: 'Un cliente realiza múltiples pedidos.', obligatoriaEnOrigen: false, obligatoriaEnDestino: true },
      ],
    };

    const ddl = generarDDLSQLite(modelo);

    const proyectoBase: ProyectoEstado = {
      ...crearProyectoInicial(),
      version: 1,
      actualizadoEn: new Date().toISOString(),
      pasoActual: 6,
      descripcionProblema: PRESET_TIENDA.promptInicial,
      rondasAclaracion: [],
      ultimaAclaracion: null,
      claridadConfirmada: true,
      modeloConceptualConfirmado: true,
      relacionesConfirmadas: true,
      diagramaConfirmado: true,
      ddlConfirmado: true,
      datosConfirmados: true,
      informesConfirmados: true,
      baseSQLiteGenerada: true,
      motorSeleccionado: 'sqlite',
      modelo,
      ddlGenerado: ddl,
      bitacora: [
        { paso: 1, fecha: new Date().toISOString(), descripcion: 'Cargó el ejemplo precargado de Tienda de Comercio.', origen: 'estudiante' },
      ],
      datosEjemplo: {
        resumenDidactico: 'Catálogo de artículos, categorías y pedidos.',
        ordenInsercion: ['categorias', 'clientes', 'productos', 'pedidos'],
        tablas: [
          {
            tabla: 'categorias',
            columnas: ['id_categoria', 'nombre'],
            filas: [
              { id_categoria: 1, nombre: 'Electrónica' },
              { id_categoria: 2, nombre: 'Hogar' },
            ],
          },
          {
            tabla: 'productos',
            columnas: ['id_producto', 'nombre', 'precio', 'stock', 'id_categoria'],
            filas: [
              { id_producto: 1, nombre: 'Auriculares Bluetooth', precio: 35000, stock: 15, id_categoria: 1 },
              { id_producto: 2, nombre: 'Lámpara de Escritorio', precio: 18500, stock: 8, id_categoria: 2 },
            ],
          },
          {
            tabla: 'clientes',
            columnas: ['id_cliente', 'nombre', 'email'],
            filas: [
              { id_cliente: 1, nombre: 'Valeria Ramos', email: 'valeria@tienda.com' },
            ],
          },
          {
            tabla: 'pedidos',
            columnas: ['id_pedido', 'fecha', 'total', 'id_cliente'],
            filas: [
              { id_pedido: 1, fecha: '2025-01-20', total: 53500, id_cliente: 1 },
            ],
          },
        ],
      },
      informes: [
        {
          id: 'inf_productos_categorias',
          titulo: 'Catálogo de Productos por Categoría',
          pedidoLenguajeNatural: 'Listar productos con su categoría y stock actual.',
          consultaSQL: 'SELECT p.nombre AS producto, c.nombre AS categoria, p.precio, p.stock FROM productos p JOIN categorias c ON p.id_categoria = c.id_categoria ORDER BY c.nombre ASC, p.precio DESC;',
          explicacionPasoAPaso: 'Combina productos y categorías con INNER JOIN sobre id_categoria y ordena por categoría.',
          tipoGrafico: 'barras',
          fechaCreacion: new Date().toISOString(),
          resultado: {
            columnas: ['producto', 'categoria', 'precio', 'stock'],
            filas: [
              ['Auriculares Bluetooth', 'Electrónica', 35000, 15],
              ['Lámpara de Escritorio', 'Hogar', 18500, 8],
            ],
            totalFilas: 2,
            tiempoMs: 2,
          },
        },
      ],
    };
    proyectoBase.analisisResumido = generarAnalisisResumidoFallback(proyectoBase);
    return proyectoBase;
  },
};

export const LISTA_PRESETS: readonly PresetProyecto[] = [
  PRESET_BIBLIOTECA,
  PRESET_VETERINARIA,
  PRESET_TIENDA,
] as const;

export function obtenerPresetPorId(id: string): PresetProyecto | undefined {
  return LISTA_PRESETS.find((p) => p.id === id);
}
