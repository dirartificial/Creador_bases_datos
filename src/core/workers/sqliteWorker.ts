import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

async function obtenerSQL(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? '/sql-wasm.wasm' : file),
    });
  }
  return SQL;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, action, payload } = e.data;
  try {
    const SqlEngine = await obtenerSQL();

    switch (action) {
      case 'INIT': {
        if (!db) {
          db = new SqlEngine.Database();
          db.run('PRAGMA foreign_keys = ON;');
        }
        self.postMessage({ id, ok: true });
        break;
      }

      case 'EXEC_DDL': {
        if (db) {
          db.close();
        }
        db = new SqlEngine.Database();
        db.run('PRAGMA foreign_keys = ON;');
        db.run(payload.ddl);
        self.postMessage({ id, ok: true });
        break;
      }

      case 'EXEC_INSERTS': {
        if (!db) {
          db = new SqlEngine.Database();
          db.run('PRAGMA foreign_keys = ON;');
        }
        const { inserts } = payload as { inserts: string[] };
        let insertadas = 0;
        for (const sql of inserts) {
          db.run(sql);
          insertadas++;
        }
        self.postMessage({ id, ok: true, insertadas });
        break;
      }

      case 'QUERY': {
        if (!db) {
          db = new SqlEngine.Database();
          db.run('PRAGMA foreign_keys = ON;');
        }
        const resultado = db.exec(payload.sql);
        self.postMessage({ id, ok: true, resultado });
        break;
      }

      case 'EXPORT': {
        if (!db) {
          db = new SqlEngine.Database();
          db.run('PRAGMA foreign_keys = ON;');
        }
        const binario = db.export();
        // Transferencia zero-copy del buffer binario
        (self as any).postMessage({ id, ok: true, binario }, [binario.buffer]);
        break;
      }

      case 'RESET': {
        if (db) {
          db.close();
          db = null;
        }
        self.postMessage({ id, ok: true });
        break;
      }

      default:
        throw new Error(`Acción desconocida en Worker SQLite: ${action}`);
    }
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
