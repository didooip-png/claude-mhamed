#!/bin/sh
# Démarrage de l'API : rôle applicatif, migrations (avec sauvegarde préalable), puis serveur.
#
# Deux comptes PostgreSQL (defense en profondeur, cf. docs/DECISIONS.md) :
#  - MIGRATE_DATABASE_URL : propriétaire du schéma (migrations, sauvegarde préalable) ;
#  - DATABASE_URL         : « pharmastock_app », non propriétaire, sans droit de modifier ni
#                           supprimer les journaux en ajout seul (mouvements, mouchard, grand livre).
# Si MIGRATE_DATABASE_URL est absent, un seul compte est utilisé (installation simple).
set -eu

OWNER_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"
# libpq n'accepte pas le paramètre « ?schema=… » propre à Prisma.
PG_URL="${OWNER_URL%%\?*}"

i=0
until pg_isready -q -d "$PG_URL"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] Base de données injoignable après 60 s." >&2
    exit 1
  fi
  sleep 1
done

# Les commandes Prisma (migrations) s'exécutent avec le compte propriétaire.
prisma() { DATABASE_URL="$OWNER_URL" node_modules/.bin/prisma "$@"; }

if prisma migrate status >/dev/null 2>&1; then
  echo "[entrypoint] Schéma à jour."
else
  HAS_HISTORY="$(psql -X -A -t -d "$PG_URL" -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>/dev/null || echo f)"
  if [ "$HAS_HISTORY" = "t" ]; then
    mkdir -p "$BACKUP_DIR"
    FILE="$BACKUP_DIR/pharmastock-pre-migration-$(date -u +%Y%m%d-%H%M%S).dump"
    echo "[entrypoint] Migrations en attente : sauvegarde préalable → $FILE"
    if ! pg_dump --format=custom --compress=9 --no-owner --file="$FILE" "$PG_URL"; then
      echo "[entrypoint] Sauvegarde préalable impossible : migration annulée, base inchangée." >&2
      rm -f "$FILE"
      exit 1
    fi
  fi
  echo "[entrypoint] Application des migrations…"
  prisma migrate deploy
fi

if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  : "${APP_DB_PASSWORD:?APP_DB_PASSWORD est obligatoire avec MIGRATE_DATABASE_URL}"
  # Rôle applicatif : créé au besoin, mot de passe resynchronisé, droits réappliqués (idempotent).
  psql -X -q -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" -d "$PG_URL" <<'SQL'
SELECT format('CREATE ROLE pharmastock_app LOGIN PASSWORD %L', :'pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmastock_app') \gexec
SELECT format('ALTER ROLE pharmastock_app PASSWORD %L', :'pw') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO pharmastock_app', current_database()) \gexec
SELECT pharmastock_apply_app_grants() \g /dev/null
SQL
fi

exec "$@"
