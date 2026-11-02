import { PGlite } from '@electric-sql/pglite';

export interface ResultadoConsultaPostgres {
  rows: any[];
  fields: { name: string; dataTypeID: number }[];
  affectedRows?: number;
}

export class PostgresClient {
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

  // Fallback directo en memoria para entornos sin Web Worker nativo (Vitest / Node / jsdom)
  private pgDirecto: PGlite | null = null;
  private timeoutMs: number;

  constructor(timeoutMs = 15000) {
    this.timeoutMs = timeoutMs;
  }

  private esSoporteWorkerNavegador(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !navigator.userAgent.includes('jsdom') &&
      !navigator.userAgent.includes('Node.js')
    );
  }

  private async asegurarWorker(): Promise<Worker> {
    if (this.worker) return this.worker;

    this.worker = new Worker(new URL('./postgresWorker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, data, error, resultado, insertadas, tablas } = e.data;
      const pendiente = this.pendienteMap.get(id);
      if (!pendiente) return;

      clearTimeout(pendiente.timer);
      this.pendienteMap.delete(id);

      if (ok) {
        if (resultado !== undefined) {
          pendiente.resolve(resultado);
        } else if (insertadas !== undefined) {
          pendiente.resolve(insertadas);
        } else if (tablas !== undefined) {
          pendiente.resolve(tablas);
        } else {
          pendiente.resolve(data);
        }
      } else {
        pendiente.reject(new Error(error || 'Error desconocido en Worker PostgreSQL'));
      }
    };

    this.worker.onerror = (e) => {
      console.error('Error no capturado en Web Worker PostgreSQL:', e);
    };

    return this.worker;
  }

  private async enviarMensajeWorker<T>(action: string, payload?: any): Promise<T> {
    const worker = await this.asegurarWorker();
    const id = ++this.idSecuencia;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendienteMap.delete(id);
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(
          new Error(
            `Tiempo de espera agotado (${this.timeoutMs} ms) al ejecutar la operación PostgreSQL: ${action}`
          )
        );
      }, this.timeoutMs);

      this.pendienteMap.set(id, { resolve, reject, timer });
      worker.postMessage({ id, action, payload });
    });
  }

  // --- Fallback en memoria directa para entornos sin Worker ---

  private async asegurarPGDirecto(): Promise<PGlite> {
    if (!this.pgDirecto) {
      this.pgDirecto = new PGlite();
    }
    return this.pgDirecto;
  }

  // --- Métodos de Alto Nivel Públicos ---

  public async inicializar(): Promise<void> {
    if (this.esSoporteWorkerNavegador()) {
      await this.enviarMensajeWorker('INIT');
    } else {
      await this.asegurarPGDirecto();
    }
  }

  public async ejecutarDDL(ddl: string): Promise<void> {
    if (this.esSoporteWorkerNavegador()) {
      await this.enviarMensajeWorker('EXEC_DDL', { ddl });
    } else {
      if (this.pgDirecto) {
        try {
          await this.pgDirecto.close();
        } catch {
          // Ignorar error al cerrar instancia previa
        }
        this.pgDirecto = null;
      }
      const engine = await this.asegurarPGDirecto();
      await engine.exec(ddl);
    }
  }

  public async ejecutarInserts(inserts: string[]): Promise<number> {
    if (this.esSoporteWorkerNavegador()) {
      return await this.enviarMensajeWorker<number>('EXEC_INSERTS', { inserts });
    } else {
      const engine = await this.asegurarPGDirecto();
      let insertadas = 0;
      for (const sql of inserts) {
        await engine.exec(sql);
        insertadas++;
      }
      return insertadas;
    }
  }

  public async ejecutarConsulta(sql: string): Promise<ResultadoConsultaPostgres> {
    if (this.esSoporteWorkerNavegador()) {
      return await this.enviarMensajeWorker<ResultadoConsultaPostgres>('QUERY', { sql });
    } else {
      const engine = await this.asegurarPGDirecto();
      const res = await engine.query(sql);
      return {
        rows: res.rows,
        fields: res.fields as any,
        affectedRows: res.affectedRows,
      };
    }
  }

  public async obtenerListaTablas(): Promise<string[]> {
    if (this.esSoporteWorkerNavegador()) {
      return await this.enviarMensajeWorker<string[]>('OBTENER_TABLAS');
    } else {
      const engine = await this.asegurarPGDirecto();
      const res = await engine.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
      );
      return (res.rows as any[]).map((r) => r.table_name);
    }
  }

  public async destruir(): Promise<void> {
    if (this.worker) {
      try {
        await this.enviarMensajeWorker('RESET');
      } catch {
        // Ignorar
      }
      this.worker.terminate();
      this.worker = null;
    }

    if (this.pgDirecto) {
      try {
        await this.pgDirecto.close();
      } catch {
        // Ignorar
      }
      this.pgDirecto = null;
    }

    this.pendienteMap.forEach(({ timer, reject }) => {
      clearTimeout(timer);
      reject(new Error('Cliente PostgreSQL destruido.'));
    });
    this.pendienteMap.clear();
  }
}

let instanciaUnicaPG: PostgresClient | null = null;

export function obtenerClientePostgres(): PostgresClient {
  if (!instanciaUnicaPG) {
    instanciaUnicaPG = new PostgresClient();
  }
  return instanciaUnicaPG;
}
