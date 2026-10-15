-- =====================================================================
--  Boutique Tissus — schéma Supabase
--  À coller dans Supabase > SQL Editor > New query > Run (une seule fois).
--  Peut être relancé sans danger (tout est "if not exists").
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1) BOUTIQUES — une ligne par boutique (multi-boutiques)
-- ---------------------------------------------------------------------
create table if not exists shops (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,            -- adresse : /<slug>
  name            text not null,
  tagline         text,                            -- petite phrase sous le nom
  city            text,
  whatsapp        text not null,                   -- chiffres seulement, avec indicatif : 22370000000
  sale_unit       text not null default 'metre'    -- 'metre' | 'piece' | 'lot'
                  check (sale_unit in ('metre','piece','lot')),
  color_primary   text not null default '#0b0b0b', -- couleur principale (ex. noir)
  color_accent    text not null default '#c9a227', -- couleur d'accent (ex. or)
  logo_path       text,                            -- chemin dans le bucket de stockage
  admin_phone     text not null,                   -- identifiant de connexion du propriétaire
  admin_pin_hash  text not null,                   -- code secret (haché, jamais en clair)
  require_review  boolean not null default false,  -- true = un produit n'est public qu'après validation
  ai_auto         boolean not null default true,   -- true = l'IA traite chaque photo automatiquement (modifiable par le propriétaire)
  admins          jsonb not null default '[]',     -- autres personnes autorisées : [{name, phone, pin_hash}]
  active          boolean not null default true,
  -- Interrupteurs des phases 2 et 3 (TOUS désactivés pour l'instant)
  features        jsonb not null default
    '{"orange_money":false,"moov_money":false,"facebook_autopost":false,"tiktok_autopost":false}',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) PRODUITS (tissus)
-- ---------------------------------------------------------------------
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references shops(id) on delete cascade,
  client_id      text,                              -- identifiant généré par le téléphone (évite les doublons si renvoi)
  name           text,                              -- rempli par l'IA, corrigeable
  category       text not null default 'autre'
                 check (category in ('dentelle','basin','broderie','wax','bazin','autre')),
  description    text,
  price          integer not null default 0 check (price >= 0), -- en FCFA ; 0 = « prix sur demande »
  original_path  text not null,                     -- photo d'origine (toujours conservée)
  enhanced_path  text,                              -- photo améliorée par le traitement
  thumb_path     text,                              -- miniature légère pour la grille
  ai_status      text not null default 'pending'
                 check (ai_status in ('pending','processing','done','failed')),
  ai_error       text,
  ai_attempts    integer not null default 0,
  reviewed       boolean not null default false,    -- false = apparaît dans « À vérifier »
  sold_out       boolean not null default false,
  -- Réservé aux phases 2/3 (publication automatique réseaux sociaux)
  social         jsonb not null default '{}',       -- ex. {"facebook_post_id":"..","tiktok_post_id":".."}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists products_client_uniq on products (shop_id, client_id) where client_id is not null;
create index if not exists products_shop_created on products (shop_id, created_at desc);
create index if not exists products_shop_category on products (shop_id, category);

-- ---------------------------------------------------------------------
-- 3) PHASE 2 (non activée) — commandes & paiements Orange Money / Moov Money
-- ---------------------------------------------------------------------
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references shops(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  quantity          numeric not null default 1,
  amount            integer not null,                -- FCFA
  customer_name     text,
  customer_phone    text,
  payment_provider  text check (payment_provider in ('orange_money','moov_money')),
  payment_status    text not null default 'none'
                    check (payment_status in ('none','pending','paid','failed','refunded')),
  provider_ref      text,                            -- référence de transaction chez l'opérateur
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4) PHASE 3 (non activée) — publications automatiques Facebook / TikTok
-- ---------------------------------------------------------------------
create table if not exists social_accounts (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  network       text not null check (network in ('facebook','tiktok')),
  external_id   text,                                -- id de la page / du compte
  access_token  text,                                -- à chiffrer avant activation de la phase 3
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (shop_id, network)
);

create table if not exists social_posts (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references shops(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  network      text not null check (network in ('facebook','tiktok')),
  status       text not null default 'queued' check (status in ('queued','posted','failed')),
  external_id  text,
  error        text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5) SÉCURITÉ
-- Le serveur utilise la clé "service_role" : il passe au-dessus de la RLS.
-- On active la RLS SANS aucune politique => la clé publique (anon) ne peut
-- rien lire ni écrire directement dans la base. Tout passe par le serveur.
-- ---------------------------------------------------------------------
alter table shops           enable row level security;
alter table products        enable row level security;
alter table orders          enable row level security;
alter table social_accounts enable row level security;
alter table social_posts    enable row level security;

-- ---------------------------------------------------------------------
-- 6) STOCKAGE DES PHOTOS — bucket public en lecture (les images de la vitrine),
--    écriture uniquement via le serveur.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tissus', 'tissus', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 7) MISE À JOUR d'une base créée avec une version précédente (sans danger si déjà à jour)
-- ---------------------------------------------------------------------
alter table shops add column if not exists ai_auto boolean not null default true;
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('dentelle','basin','broderie','wax','bazin','autre'));

-- ---------------------------------------------------------------------
-- 8) Codes de connexion par téléphone (état partagé entre instances serverless)
-- ---------------------------------------------------------------------
create table if not exists otp_state (
  key    text primary key,          -- "<boutique>|<8 derniers chiffres>"
  hash   text,                      -- HMAC du code (jamais le code en clair)
  exp    bigint not null default 0, -- expiration (ms epoch)
  tries  integer not null default 0,
  sends  jsonb not null default '[]' -- horodatages des envois (limites 30 s / 5 par heure)
);
alter table otp_state enable row level security;

-- 9) Autres personnes autorisées à gérer une boutique (mise à jour d'une base existante)
alter table shops add column if not exists admins jsonb not null default '[]';
