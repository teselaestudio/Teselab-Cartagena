# Visor Cartagena — Sistema de Acceso con Base de Datos

Este proyecto implementa un sistema de control de acceso seguro compatible al 100% con **GitHub Pages** (alojamiento estático), respaldado por una base de datos en la nube con **Supabase Auth**.

---

## 📁 Estructura del Proyecto

- [index.html](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/index.html): Pantalla de inicio de sesión (Login).
- [landing.html](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/landing.html): Página de aterrizaje protegida (*Work in Progress*). Si un usuario no autenticado entra aquí directamente, es redirigido al login.
- [config.js](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/config.js): Archivo donde introduces las claves públicas de tu base de datos Supabase.
- [auth.js](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/auth.js): Lógica de autenticación, control de sesiones y guardias de seguridad.
- [style.css](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/style.css): Hoja de estilos moderna y responsiva.

---

## 🚀 Pasos para Ponerlo en Marcha

### Paso 1: Crear proyecto en Supabase (Gratuito)
1. Entra en [https://supabase.com](https://supabase.com) e inicia sesión con tu cuenta de GitHub o correo.
2. Pulsa en **"New Project"**.
3. Elige un nombre (ej. `visor-cartagena`), una contraseña para la base de datos y la región más cercana (ej. `West Europe / Frankfurt` o `Spain / Madrid`).
4. Haz clic en **"Create new project"** (tarda aproximadamente 1 minuto en aprovisionarse).

### Paso 2: Obtener las claves y pegarlas en `config.js`
1. En tu panel de Supabase, en el menú lateral izquierdo, haz clic en el icono de engranaje **Project Settings** (abajo del todo) -> **API**.
2. Verás dos campos clave:
   - **Project URL**: Ejemplo `https://xyzabc.supabase.co`
   - **Project API keys** -> **anon public**: Cadena larga de caracteres.
3. Abre el archivo [config.js](file:///h:/.shortcut-targets-by-id/1ejrkrQGZoRNb5Z3mnGplbenfJxpx4au0/TESELA/XX_Otros%20trabajos/22_Antigravity%20projects/00_visor%20Cartagena/config.js) y sustituye los valores de ejemplo por los tuyos.

### Paso 3: Dar de alta a tus usuarios autorizados
1. En el panel de Supabase, ve a **Authentication** (icono con un candado / silueta) -> pestaña **Users**.
2. Pulsa en el botón verde **"Add user"** -> **"Create user"**.
3. Escribe el **Email** y la **Password** de la persona que tendrá acceso.
4. Desmarca la casilla *Send invite email* si quieres asignarle la contraseña directamente tú mismo.
5. Pulsa en **Create user**. ¡Listo! Ese usuario ya está en la base de datos listo para autenticarse.

*(Opcional: Si deseas desactivar el registro público para que nadie más pueda registrarse por su cuenta, ve a **Authentication** -> **Providers** -> **Email** y desactiva la opción **"Allow new users to sign up"**).*

---

## 🌐 Publicar en GitHub Pages

1. Sube estos archivos a tu repositorio de GitHub (rama `main` o `master`).
2. En GitHub, entra en tu repositorio y ve a **Settings** (pestaña superior).
3. En el menú izquierdo, haz clic en **Pages**.
4. En **Build and deployment**:
   - Source: **Deploy from a branch**.
   - Branch: Selecciona `main` (o `master`) y la carpeta `/ (root)`.
5. Pulsa en **Save**. En un par de minutos tu página estará activa en la URL de GitHub Pages (ej. `https://tu-usuario.github.io/tu-repo/`).
