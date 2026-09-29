import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_CONFIG } from "./config.js";

// Validar si el usuario aún tiene los valores por defecto
export function isConfigured() {
  return (
    SUPABASE_CONFIG.url &&
    !SUPABASE_CONFIG.url.includes("TU_PROYECTO") &&
    SUPABASE_CONFIG.anonKey &&
    !SUPABASE_CONFIG.anonKey.includes("TU_ANON_PUBLIC_KEY")
  );
}

// Inicializar cliente Supabase
export const supabase = isConfigured()
  ? createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
  : null;

/**
 * Inicia sesión con correo y contraseña en la base de datos de Supabase.
 */
export async function login(email, password) {
  if (!isConfigured()) {
    throw new Error(
      "Debes configurar tu URL y Anon Key en 'config.js' antes de poder iniciar sesión."
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: password
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Cierra la sesión activa del usuario y redirige al login.
 */
export async function logout() {
  if (supabase) {
    await supabase.auth.signOut();
  }
  window.location.href = "index.html";
}

/**
 * Obtiene la sesión actual almacenada de forma segura.
 */
export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Guardia de ruta para páginas protegidas (ej. landing.html).
 * Si no hay sesión válida, redirige inmediatamente a index.html.
 */
export async function requireAuth() {
  if (!isConfigured()) {
    // Si no está configurado, enviar al login para que muestre el aviso
    window.location.href = "index.html";
    return null;
  }

  const session = await getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }

  return session;
}

/**
 * Si el usuario ya está autenticado y visita index.html, redirige a la landing page.
 */
export async function redirectIfAuthenticated() {
  if (!isConfigured()) return;

  const session = await getSession();
  if (session) {
    window.location.href = "landing.html";
  }
}
