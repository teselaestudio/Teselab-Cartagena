// ==============================================================================
// CONFIGURACIÓN DE ACCESO (SUPABASE)
// ==============================================================================
// 1. Ve a https://supabase.com y crea un proyecto gratuito si aún no lo tienes.
// 2. En tu panel de Supabase ve a: Project Settings -> API.
// 3. Copia y pega aquí la "Project URL" y la "anon public key".
//
// NOTA DE SEGURIDAD:
// La clave 'anon' es de carácter público y está diseñada para usarse en el navegador.
// La seguridad real la gestiona Supabase cifrando contraseñas y emitiendo tokens JWT.
// ==============================================================================

export const SUPABASE_CONFIG = {
  url: "https://urxyqphrxrqgglcfvjdn.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyeHlxcGhyeHJxZ2dsY2Z2amRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NjMwMzUsImV4cCI6MjEwNDUzOTAzNX0.Hr86gOnAfoVhM0Hr9BGvmASmIqAFuOdtY-kLdJSiqa4"
};
