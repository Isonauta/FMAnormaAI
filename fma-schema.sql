-- ═══════════════════════════════════════════════
-- NORMAAI FMA — Schema Supabase
-- Ejecutar en: SQL Editor del proyecto normaai-fma
-- ═══════════════════════════════════════════════

-- PERFILES DE USUARIOS
create table if not exists usuarios (
  id uuid default gen_random_uuid() primary key,
  auth_id uuid references auth.users(id) on delete cascade,
  nombre text,
  email text,
  rol text default 'operador', -- operador, supervisor, admin
  created_at timestamp with time zone default now()
);

-- NO CONFORMIDADES
create table if not exists no_conformidades (
  id uuid default gen_random_uuid() primary key,
  codigo text,
  descripcion text,
  area text,
  norma text,
  responsable text,
  prioridad text default 'Media',
  estado text default 'Abierta',
  progreso integer default 10,
  fecha_deteccion date,
  accion_inmediata text,
  resp_inmediata text,
  fecha_inmediata date,
  -- 5 Por Qué
  pq1 text, pq2 text, pq3 text, pq4 text, pq5 text,
  -- Acción correctiva
  accion_correctiva text,
  resp_correctiva text,
  fecha_limite date,
  recursos text,
  -- Verificación
  verificacion text,
  verificador text,
  fecha_cierre date,
  -- Meta
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- DOCUMENTOS
create table if not exists documentos (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  codigo text,
  norma text,
  version text default 'v1.0',
  tipo text, -- Procedimiento, Instructivo, Registro, Manual, Norma
  url text,
  descripcion text,
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default now()
);

-- ── RLS ─────────────────────────────────────────────
alter table usuarios enable row level security;
alter table no_conformidades enable row level security;
alter table documentos enable row level security;

-- Usuarios autenticados tienen acceso completo
create policy "Auth full access NC" on no_conformidades
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Auth full access docs" on documentos
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Auth full access usuarios" on usuarios
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ── STORAGE ─────────────────────────────────────────
-- Crea manualmente en Supabase > Storage:
-- Bucket: "documentos" (public)

-- ── TRIGGER updated_at ──────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger nc_updated_at
  before update on no_conformidades
  for each row execute function update_updated_at();
