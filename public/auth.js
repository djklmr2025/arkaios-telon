// Authentication for Arkaios Telón using official Arkaios Google Auth (Firebase)
export const FIREBASE_CONFIG = Object.freeze({
  projectId: 'arkaios-world',
  appId: '1:502663599735:web:d702f5242ff9672e9c9872',
  apiKey: 'AIzaSyD-ceCiJPVnLlepVBcMBhLABJEC771uypM',
  authDomain: 'arkaios-world.firebaseapp.com',
  storageBucket: 'arkaios-world.firebasestorage.app',
  messagingSenderId: '502663599735',
  measurementId: 'G-7DM0S4M5QJ',
  oAuthClientId: '502663599735-e4p66giu79jpjiofi570loibdimuiqtm.apps.googleusercontent.com',
});

const AUTH_STORAGE_KEY = 'telon:auth_user';
let authInstance = null;
let googleProvider = null;
let currentUser = readCachedUser();
const listeners = new Set();

function readCachedUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistUser(user) {
  try {
    if (user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // ignore local storage errors
  }
}

function normalizeUser(rawUser) {
  if (!rawUser) return null;
  return {
    uid: rawUser.uid,
    displayName: rawUser.displayName || rawUser.email?.split('@')[0] || 'Viajero Arkaios',
    email: rawUser.email || '',
    photoURL: rawUser.photoURL || '',
  };
}

function notifyListeners(user) {
  currentUser = user;
  persistUser(user);
  for (const listener of listeners) {
    try {
      listener(currentUser);
    } catch (err) {
      console.error('Error in auth listener:', err);
    }
  }
}

async function loadFirebase() {
  if (authInstance) return { auth: authInstance, provider: googleProvider };

  try {
    const [appMod, authMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
    ]);

    const app = appMod.getApps?.().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    authInstance = auth;
    googleProvider = provider;

    authMod.onAuthStateChanged(auth, (rawUser) => {
      notifyListeners(normalizeUser(rawUser));
    });

    return { auth, provider, authMod };
  } catch (err) {
    console.warn('Firebase Auth SDK no pudo cargarse (modo offline o bloqueo de red):', err);
    return null;
  }
}

export function getCurrentUser() {
  return currentUser;
}

export async function initAuth(onUserChange) {
  if (typeof onUserChange === 'function') {
    listeners.add(onUserChange);
    // Notify immediately with current/cached user to avoid UI jump
    onUserChange(currentUser);
  }
  return loadFirebase();
}

export async function loginWithGoogle() {
  const fb = await loadFirebase();
  if (!fb) {
    throw new Error('No se pudo conectar con el servicio de autenticación de Arkaios. Revisa tu conexión a internet.');
  }

  const { auth, provider } = fb;
  const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  try {
    const credential = await signInWithPopup(auth, provider);
    const user = normalizeUser(credential.user);
    notifyListeners(user);
    return user;
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') {
      throw new Error('Ventana de acceso cerrada por el usuario.');
    }
    if (err.code === 'auth/cancelled-popup-request') {
      throw new Error('Petición de acceso cancelada.');
    }
    throw new Error(err.message || 'Error al iniciar sesión con Google.');
  }
}

export async function logout() {
  const fb = await loadFirebase();
  if (fb) {
    const { auth } = fb;
    const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await signOut(auth);
  }
  notifyListeners(null);
}
