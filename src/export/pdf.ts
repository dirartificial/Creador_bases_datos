import { jsPDF } from 'jspdf';
import { AnalisisResumido, ProyectoEstado } from '../core/schemas';

/**
 * Normaliza caracteres especiales para asegurar máxima legibilidad en fuentes estándar jsPDF.
 */
function normalizarTextoParaPdf(texto: string): string {
  if (!texto) return '';
  return texto
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/•/g, '*');
}

/**
 * Genera el documento PDF de 1-2 páginas del Análisis Resumido en el cliente.
 * Devuelve un Uint8Array para su integración directa en ZIP o descarga como Blob.
 */
export function generarPdfAnalisisResumido(
  analisis: AnalisisResumido,
  proyecto: ProyectoEstado
): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function verificarSaltoPagina(espacioRequerido: number) {
    if (y + espacioRequerido > pageHeight - margin - 10) {
      doc.addPage();
      y = margin;
      renderizarEncabezadoPagina();
    }
  }

  function renderizarEncabezadoPagina() {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      'DB-TUTOR | Informe Pedagógico de Diseño de Base de Datos',
      margin,
      y
    );
    doc.text(
      new Date().toLocaleDateString('es-AR'),
      pageWidth - margin,
      y,
      { align: 'right' }
    );
    y += 4;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  }

  // --- Portada / Encabezado Principal ---
  renderizarEncabezadoPagina();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(24, 43, 73); // Azul institucional
  doc.text('Análisis Resumido de Arquitectura y Diseño', margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Motor seleccionado: ${proyecto.motorSeleccionado?.toUpperCase() || 'SQLITE'} | Entidades: ${
      proyecto.modelo.entidades.length
    } | Relaciones: ${proyecto.modelo.relaciones.length}`,
    margin,
    y
  );
  y += 7;

  // Función auxiliar para renderizar una sección con título
  function renderSeccion(numero: number, titulo: string, contenidoFn: () => void) {
    verificarSaltoPagina(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 64, 175); // Azul medio
    doc.text(`${numero}. ${titulo}`, margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    contenidoFn();
    y += 4;
  }

  // 1. Problema y Alcance
  renderSeccion(1, 'Problema Planteado y Alcance', () => {
    const texto = normalizarTextoParaPdf(analisis.problemaYAlcance);
    const lineas = doc.splitTextToSize(texto, contentWidth);
    verificarSaltoPagina(lineas.length * 4.5);
    doc.text(lineas, margin, y);
    y += lineas.length * 4.5;
  });

  // 2. Decisiones de diseño clave
  renderSeccion(2, 'Decisiones de Diseño Clave y Justificación', () => {
    if (analisis.decisionesDisenoClave.length === 0) {
      doc.text('No se registraron decisiones específicas en la bitácora.', margin, y);
      y += 5;
      return;
    }

    for (const d of analisis.decisionesDisenoClave.slice(0, 5)) {
      const etiqueta =
        d.origen === 'ia_aceptada'
          ? '[Sugerencia IA]'
          : d.origen === 'ia_rechazada'
          ? '[Modificado Estudiante]'
          : '[Decisión Estudiante]';

      const textoDecision = normalizarTextoParaPdf(`* ${etiqueta} ${d.decision}: ${d.justificacion}`);
      const lineas = doc.splitTextToSize(textoDecision, contentWidth - 4);
      verificarSaltoPagina(lineas.length * 4.5 + 2);
      doc.text(lineas, margin + 2, y);
      y += lineas.length * 4.5 + 2;
    }
  });

  // 3. Observaciones del validador
  renderSeccion(3, 'Observaciones del Validador y Resolución Pedagógica', () => {
    if (analisis.observacionesValidadorYResolucion.length === 0) {
      doc.text('El modelo no presentó inconsistencias estructurales.', margin, y);
      y += 5;
      return;
    }

    for (const obs of analisis.observacionesValidadorYResolucion.slice(0, 4)) {
      const texto = normalizarTextoParaPdf(`* Obs: ${obs.observacion} -> Solución: ${obs.resolucion}`);
      const lineas = doc.splitTextToSize(texto, contentWidth - 4);
      verificarSaltoPagina(lineas.length * 4.5 + 2);
      doc.text(lineas, margin + 2, y);
      y += lineas.length * 4.5 + 2;
    }
  });

  // 4. Motor elegido y limitaciones
  renderSeccion(4, 'Motor de Base de Datos y Limitaciones', () => {
    const texto = normalizarTextoParaPdf(
      `Motor: ${proyecto.motorSeleccionado || 'sqlite'}. ${analisis.motorElegidoYJustificacion} Limitaciones: ${analisis.limitacionesDelMotor}`
    );
    const lineas = doc.splitTextToSize(texto, contentWidth);
    verificarSaltoPagina(lineas.length * 4.5);
    doc.text(lineas, margin, y);
    y += lineas.length * 4.5;
  });

  // 5. Resumen de informes
  renderSeccion(5, 'Resumen de Informes y Consultas SQL', () => {
    if (analisis.resumenInformes.length === 0) {
      doc.text('No se configuraron consultas analíticas en la sesión.', margin, y);
      y += 5;
      return;
    }

    for (const inf of analisis.resumenInformes.slice(0, 3)) {
      const texto = normalizarTextoParaPdf(`* ${inf.titulo}: ${inf.preguntaQueResponde}`);
      const lineas = doc.splitTextToSize(texto, contentWidth - 4);
      verificarSaltoPagina(lineas.length * 4.5 + 8);
      doc.setFont('helvetica', 'bold');
      doc.text(lineas, margin + 2, y);
      y += lineas.length * 4.5;

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      const sqlLineas = doc.splitTextToSize(inf.consultaSql.trim(), contentWidth - 8);
      doc.text(sqlLineas, margin + 4, y);
      y += sqlLineas.length * 4 + 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    }
  });

  // 6. Puntos a mejorar y próximos pasos
  renderSeccion(6, 'Puntos a Mejorar y Próximos Pasos', () => {
    for (const paso of analisis.puntosAMejorarYProximosPasos.slice(0, 4)) {
      const texto = normalizarTextoParaPdf(`- ${paso}`);
      const lineas = doc.splitTextToSize(texto, contentWidth - 4);
      verificarSaltoPagina(lineas.length * 4.5 + 1);
      doc.text(lineas, margin + 2, y);
      y += lineas.length * 4.5 + 1;
    }
  });

  // Pie de página con numeración total
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Página ${i} de ${totalPages} | Documento emitido localmente sin backend`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}
