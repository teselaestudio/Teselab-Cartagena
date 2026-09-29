---
name: security-audit
description: Security guidance and vulnerability review for web applications, APIs, auth systems, token management, and client-side code. Use when designing authentication flows, reviewing credentials or keys, checking CORS/RLS, or evaluating security postures.
license: MIT
---

# Security Audit Skill

Defensive security guidance for client-side web apps, database integrations (Supabase, Firebase, REST APIs), and authentication systems.

## Core Rules for Client-Side Applications (GitHub Pages / SPA)

1. **Client Trust Boundary**:
   - The browser environment is untrusted. Any code, HTML, CSS, or JavaScript delivered to the client can be inspected.
   - Never store private database passwords, service role keys (`service_role`), admin tokens, or private API keys in client-side files.
   - Only publish anonymous/public client keys (`anonKey`) that are restricted by database Row-Level Security (RLS) policies.

2. **Session and Token Handling**:
   - Store session JWT tokens using standard browser security practices.
   - Clear session state completely on logout (`auth.signOut()`).
   - Guard protected views: verify token freshness and validity before rendering private data or making API calls.

3. **Input Sanitization & Output Encoding**:
   - Always sanitize and escape user-supplied strings before rendering into the DOM to prevent Cross-Site Scripting (XSS).
   - Use `textContent` or framework templating rather than raw `innerHTML` whenever handling variable user input.

4. **Access Control & Database Protection**:
   - Enable Row Level Security (RLS) on all tables in Supabase / PostgreSQL.
   - Deny by default: Ensure unauthenticated users have zero read/write access to internal data tables.
