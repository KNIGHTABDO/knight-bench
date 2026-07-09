export interface WatchProgress {
  profileId: string;
  titleId: string;
  progress: number; // float from 0 to 1
  updatedAt: number; // Unix timestamp
}

const DB_NAME = 'ContinueWatchingDB';
const DB_VERSION = 1;
const STORE_NAME = 'progress';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available in the browser'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['profileId', 'titleId'] });
        store.createIndex('profileId', 'profileId', { unique: false });
      }
    };
  });
}

export function getProgress(profileId: string, titleId: string): Promise<WatchProgress | null> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get([profileId, titleId]);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  });
}

export function getAllProgressForProfile(profileId: string): Promise<WatchProgress[]> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('profileId');
      const request = index.getAll(profileId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  });
}

export function saveProgress(profileId: string, titleId: string, progress: number): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const record: WatchProgress = {
        profileId,
        titleId,
        progress,
        updatedAt: Date.now(),
      };
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  });
}

let lastSaveTime = 0;
let throttleTimeout: NodeJS.Timeout | null = null;
let pendingProgress: number | null = null;

export function saveProgressThrottled(profileId: string, titleId: string, progress: number) {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  pendingProgress = progress;

  const executeSave = () => {
    if (pendingProgress !== null) {
      saveProgress(profileId, titleId, pendingProgress).catch((err) =>
        console.error('Error saving progress:', err)
      );
      pendingProgress = null;
      lastSaveTime = Date.now();
    }
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
  };

  if (now - lastSaveTime >= 5000) {
    executeSave();
  } else if (!throttleTimeout) {
    throttleTimeout = setTimeout(executeSave, 5000 - (now - lastSaveTime));
  }
}

export function forceSaveProgress(profileId: string, titleId: string, progress: number) {
  if (typeof window === 'undefined') return;

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
    throttleTimeout = null;
  }
  pendingProgress = null;
  saveProgress(profileId, titleId, progress).catch((err) =>
    console.error('Error forcing progress save:', err)
  );
  lastSaveTime = Date.now();
}
