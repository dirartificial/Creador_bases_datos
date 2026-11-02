import mermaid from 'mermaid';
import { sanitizarSvg } from '../export/svg';

let inicializado = false;

/**
 * Inicializa la librería Mermaid con securityLevel: 'strict' según el requerimiento de seguridad.
 */
export function inicializarMermaid(): void {
  if (!inicializado) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: false,
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      er: {
        useMaxWidth: true,
      },
    });
    inicializado = true;
  }
}

let contadorRenders = 0;

export interface ResultadoRenderMermaid {
  svgSanitizado: string;
  svgOriginal: string;
}

/**
 * Renderiza código Mermaid en SVG y lo sanitiza estrictamente antes de entregarlo a la UI o descargas.
 */
export async function renderizarDiagramaMermaid(
  codigoMermaid: string
): Promise<ResultadoRenderMermaid> {
  inicializarMermaid();
  contadorRenders++;
  const renderId = `mermaid-er-${Date.now()}-${contadorRenders}`;

  const { svg } = await mermaid.render(renderId, codigoMermaid);
  const svgSanitizado = sanitizarSvg(svg);

  return {
    svgSanitizado,
    svgOriginal: svg,
  };
}
