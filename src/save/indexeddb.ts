import { DB_NAME, DB_VERSION } from "../config";
import { PlayerSaveState, WorldMeta } from "../types";

const STORE_META = "meta";
const STORE_CHUNKS = "chunks";
const STORE_PLAYER = "player";

interface ChunkRecord {
  key: string;
  blocks: ArrayBuffer;
}

export class IndexedDbSaveRepository {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) {
      return;
    }
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error ?? new Error("Failed opening IndexedDB"));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          db.createObjectStore(STORE_CHUNKS, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_PLAYER)) {
          db.createObjectStore(STORE_PLAYER, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async loadWorldMeta(): Promise<WorldMeta | null> {
    const record = await this.getRecord<{ key: string; value: WorldMeta }>(STORE_META, "world");
    return record?.value ?? null;
  }

  async saveWorldMeta(meta: WorldMeta): Promise<void> {
    await this.putRecord(STORE_META, { key: "world", value: meta });
  }

  async loadChunk(key: string): Promise<Uint16Array | null> {
    const record = await this.getRecord<ChunkRecord>(STORE_CHUNKS, key);
    if (!record) {
      return null;
    }
    return new Uint16Array(record.blocks.slice(0));
  }

  async saveChunk(key: string, blocks: Uint16Array): Promise<void> {
    const copy = blocks.slice().buffer;
    await this.putRecord(STORE_CHUNKS, { key, blocks: copy });
  }

  async loadPlayer(): Promise<PlayerSaveState | null> {
    const record = await this.getRecord<{ key: string; value: PlayerSaveState }>(STORE_PLAYER, "player");
    return record?.value ?? null;
  }

  async savePlayer(playerState: PlayerSaveState): Promise<void> {
    await this.putRecord(STORE_PLAYER, { key: "player", value: playerState });
  }

  private getDatabase(): IDBDatabase {
    if (!this.db) {
      throw new Error("IndexedDbSaveRepository is not initialized");
    }
    return this.db;
  }

  private getRecord<T>(storeName: string, key: string): Promise<T | null> {
    const db = this.getDatabase();
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onerror = () => reject(req.error ?? new Error(`Failed reading ${storeName}`));
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    });
  }

  private putRecord(storeName: string, value: unknown): Promise<void> {
    const db = this.getDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onerror = () => reject(req.error ?? new Error(`Failed writing ${storeName}`));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Transaction failed for ${storeName}`));
    });
  }
}
