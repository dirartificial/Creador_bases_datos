import { PGlite } from '@electric-sql/pglite';

let pg: PGlite | null = null;

async function obtenerPG(): Promise<PGlite> {
  if (!pg) {
    pg = new PGlite();
  }
  return pg;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, action, payload } = e.data;
  try {
    switch (action) {
      case 'INIT': {
        await obtenerPG();
        self.postMessage({ id, ok: true });
        break;
      }

      case 'EXEC_DDL': {
        if (pg) {
          try {
            await pg.close();
          } catch {
            // Ignorar error al cerrar
          }
          pg = null;
        }
        pg = new PGlite();
        await pg.exec(payload.ddl);
        self.postMessage({ id, ok: true });
        break;
      }

      case 'EXEC_INSERTS': {
        const engine = await obtenerPG();
        const { inserts } = payload as { inserts: string[] };
        let insertadas = 0;
        for (const sql of inserts) {
          await engine.exec(sql);
          insertadas++;
        }
        self.postMessage({ id, ok: true, insertadas });
        break;
      }

      case 'QUERY': {
        const engine = await obtenerPG();
        const resultado = await engine.query(payload.sql);
        self.postMessage({ id, ok: true, resultado });
        break;
      }

      case 'OBTENER_TABLAS': {
        const engine = await obtenerPG();
        const res = await engine.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
        );
        const tablas = (res.rows as any[]).map((r) => r.table_name);
        self.postMessage({ id, ok: true, tablas });
        break;
      }

      case 'RESET': {
        if (pg) {
          try {
            await pg.close();
          } catch {
            // Ignorar error al cerrar
          }
          pg = null;
        }
        self.postMessage({ id, ok: true });
        break;
      }

      default:
        throw new Error(`Acción desconocida en Worker PostgreSQL: ${action}`);
    }
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
