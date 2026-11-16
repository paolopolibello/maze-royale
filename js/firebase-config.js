// Configurazione opzionale per Firebase Realtime Database.
// Puoi compilare qui i dati del tuo progetto Firebase oppure inserirli
// direttamente in gioco dal pannello "Multiplayer / Firebase".

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  databaseURL: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

const STORAGE_KEY = 'maze_royale_firebase_cfg_v1';

export function loadFirebaseConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.databaseURL === 'string' && parsed.databaseURL.trim()) {
        return parsed;
      }
    }
  } catch (_) {
    // Ignora storage non disponibile
  }
  return { ...DEFAULT_FIREBASE_CONFIG };
}

export function saveFirebaseConfig(cfg) {
  try {
    if (!cfg || !cfg.databaseURL?.trim()) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (_) {
    // Ignora errori storage
  }
}

export function isFirebaseConfigured(cfg) {
  return Boolean(cfg && typeof cfg.databaseURL === 'string' && cfg.databaseURL.trim().startsWith('http'));
}
