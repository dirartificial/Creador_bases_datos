import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

export interface ResultadoConsultaSQLite {
  columns: string[];
  values: any[][];
}

export interface ResumenTablaBD {
  nombre: string;
  totalFilas: number;
}

export class SQLiteClient {
  private worker: Worker | null = null;
  private idSecuencia = 0;
  private pendienteMap = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // Respaldo en memoria directa (para entornos de pruebas como Vitest / jsdom)
  private SQLDirecto: SqlJsStatic | null = null;
  private dbDirecta: Database | null = null;
  private timeoutMs: number;

  constructor(timeoutMs = 15000) {
    this.timeoutMs = timeoutMs;
  }

  private esSoporteWorkerNavegador(): boolean {
    return typeof window !== 'undefined' && typeof Worker !== 'undefined';
  }

  private async asegurarWorker(): Promise<Worker> {
    if (this.worker) return this.worker;

    // Instanciación nativa de Worker en Vite mediante ESM
    this.worker = new Worker(new URL('./sqliteWorker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, data, error, resultado, binario, insertadas } = e.data;
      const pendiente = this.pendienteMap.get(id);
      if (!pendiente) return;

      clearTimeout(pendiente.timer);
      this.pendienteMap.delete(id);

      if (ok) {
        if (resultado !== undefined) {
          pendiente.resolve(resultado);
        } else if (binario !== undefined) {
          pendiente.resolve(binario);
        } else if (insertadas !== undefined) {
          pendiente.resolve(insertadas);
        } else {
          pendiente.resolve(data);
        }
      } else {
        pendiente.reject(new Error(error || 'Error desconocido en Worker SQLite'));
      }
    };

    this.worker.onerror = (e) => {
      console.error('Error no capturado en Web Worker SQLite:', e);
    };

    return this.worker;
  }

  private async enviarMensajeWorker<T>(action: string, payload?: any): Promise<T> {
    const worker = await this.asegurarWorker();
    const id = ++this.idSecuencia;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendienteMap.delete(id);
        // Si hay timeout (ej: bucle infinito o bloqueo), forzamos reinicio del worker
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(
          new Error(
            `Tiempo de espera agotado (${this.timeoutMs} ms) al ejecutar la operación SQLite: ${action}`
          )
        );
      }, this.timeoutMs);

      this.pendienteMap.set(id, { resolve, reject, timer });
      worker.postMessage({ id, action, payload });
    });
  }

  // --- Fallback en memoria directa para entornos sin Web Worker (Node / Vitest) ---
  private async asegurarDirecto(): Promise<Database> {
    if (!this.SQLDirecto) {
      this.SQLDirecto = await initSqlJs({
        locateFile: (file) => (file.endsWith('.wasm') ? 'public/sql-wasm.wasm' : file),
      });
    }
    if (!this.dbDirecta) {
      this.dbDirecta = new this.SQLDirecto.Database();
      this.dbDirecta.run('PRAGMA foreign_keys = ON;');
    }
    return this.dbDirecta;
  }

  public async inicializar(): Promise<void> {
    if (this.esSoporteWorkerNavegador()) {
      await this.enviarMensajeWorker('INIT');
    } else {
      await this.asegurarDirecto();
    }
  }

  public async ejecutarDDL(ddl: string): Promise<void> {
    if (this.esSoporteWorkerNavegador()) {
      await this.enviarMensajeWorker('EXEC_DDL', { ddl });
    } else {
      const db = await this.asegurarDirecto();
      db.run('PRAGMA foreign_keys = ON;');
      db.run(ddl);
    }
  }

  public async insertarDatos(inserts: string[]): Promise<number> {
    if (this.esSoporteWorkerNavegador()) {
      return this.enviarMensajeWorker<number>('EXEC_INSERTS', { inserts });
    } else {
      const db = await this.asegurarDirecto();
      let insertadas = 0;
      for (const sql of inserts) {
        db.run(sql);
        insertadas++;
      }
      return insertadas;
    }
  }

  public async ejecutarConsulta(sql: string): Promise<ResultadoConsultaSQLite[]> {
    if (this.esSoporteWorkerNavegador()) {
      return this.enviarMensajeWorker<ResultadoConsultaSQLite[]>('QUERY', { sql });
    } else {
      const db = await this.asegurarDirecto();
      return db.exec(sql);
    }
  }

  public async exportarBinario(): Promise<Uint8Array> {
    if (this.esSoporteWorkerNavegador()) {
      return this.enviarMensajeWorker<Uint8Array>('EXPORT');
    } else {
      const db = await this.asegurarDirecto();
      return db.export();
    }
  }

  public async obtenerResumenTablas(): Promise<ResumenTablaBD[]> {
    // Consulta del catálogo sqlite_master para listar tablas de usuario
    const res = await this.ejecutarConsulta(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    );

    if (!res || res.length === 0 || !res[0].values) {
      return [];
    }

    const nombresTablas = res[0].values.map((v) => String(v[0]));
    const resumen: ResumenTablaBD[] = [];

    for (const nombre of nombresTablas) {
      try {
        const countRes = await this.ejecutarConsulta(`SELECT COUNT(*) FROM "${nombre}";`);
        const total =
          countRes && countRes[0] && countRes[0].values && countRes[0].values[0]
            ? Number(countRes[0].values[0][0])
            : 0;
        resumen.push({ nombre, totalFilas: total });
      } catch {
        resumen.push({ nombre, totalFilas: 0 });
      }
    }

    return resumen;
  }

  public async reiniciar(): Promise<void> {
    if (this.esSoporteWorkerNavegador()) {
      await this.enviarMensajeWorker('RESET');
    }
    if (this.dbDirecta) {
      try {
        this.dbDirecta.close();
      } catch {
        // silencioso al cerrar
      }
      this.dbDirecta = null;
    }
  }

  public destruir(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.dbDirecta) {
      try {
        this.dbDirecta.close();
      } catch {
        // silencioso
      }
      this.dbDirecta = null;
    }
    this.pendienteMap.clear();
  }

  /**
   * Genera la descarga del archivo binario .sqlite en el navegador del estudiante.
   */
  public descargarArchivoSQLite(
    binario: Uint8Array,
    nombreArchivo = 'base_de_datos.sqlite'
  ): void {
    const blob = new Blob([binario as unknown as BlobPart], {
      type: 'application/x-sqlite3',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

// Instancia única (singleton) para el ciclo de vida de la aplicación
export const sqliteClient = new SQLiteClient();
