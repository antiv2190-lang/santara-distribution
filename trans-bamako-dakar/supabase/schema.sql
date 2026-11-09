-- Trans Bamako-Dakar : schéma Supabase (PostgreSQL)
create extension if not exists "pgcrypto";

create type truck_type as enum ('plateau','remorque_40t','carrosserie');
create type truck_status as enum ('libre','bientot_libre','occupe','inconnu');
create type request_status as enum ('nouvelle','en_matching','proposee','confirmee','en_cours','livree','annulee');

create table carriers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company text,
  phone text not null unique,          -- numéro WhatsApp
  city text not null,
  verified boolean not null default false,
  reactivity_score int not null default 50,
  created_at timestamptz not null default now()
);

create table trucks (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references carriers(id) on delete cascade,
  type truck_type not null,
  capacity_tons numeric not null,
  plate text not null,
  corridors text[] not null default '{}',   -- ex: {'bamako-dakar','bamako-abidjan'}
  status truck_status not null default 'inconnu',
  current_city text,
  free_from date,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text not null,
  corridor text not null check (corridor in ('bamako-dakar','dakar-bamako','bamako-abidjan','abidjan-bamako')),
  truck_type truck_type not null,
  goods text not null,
  weight_tons numeric not null,
  pickup_date date not null,
  budget_fcfa bigint,
  status request_status not null default 'nouvelle',
  created_at timestamptz not null default now()
);

create table missions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  truck_id uuid not null references trucks(id),
  agreed_price_fcfa bigint,
  commission_pct numeric not null default 8,
  status text not null default 'proposee',
  delivered_proof_url text,
  created_at timestamptz not null default now()
);

-- Un camion sans réponse depuis 48 h passe en 'inconnu' (à planifier via pg_cron)
create or replace function expire_stale_trucks() returns void language sql as $$
  update trucks set status = 'inconnu'
  where status <> 'inconnu' and status_updated_at < now() - interval '48 hours';
$$;

-- Sécurité : RLS activée. Les clients/transporteurs n'écrivent que via l'API serveur.
alter table carriers enable row level security;
alter table trucks   enable row level security;
alter table requests enable row level security;
alter table missions enable row level security;
-- Aucune policy publique : l'accès se fait avec la clé service côté serveur / back-office.
