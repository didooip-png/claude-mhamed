#!/bin/sh
# Démarrage de l'API : applique les migrations (avec sauvegarde préalable) puis lance le serveur.
set -eu

# libpq n'accepte pas le paramètre « ?schema=… » propre à Prisma.
PG_URL="${DATABASE_URL%%\?*}"

# Attente de la base (le healthcheck de docker compose la garantit déjà ; sécurité en plus).
i=0
until pg_isready -q -d "$PG_URL"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] Base de données injoignable après 60 s." >&2
    exit 1
  fi
  sleep 1
done

# Migrations en attente ? (première installation : la table _prisma_migrations n'existe pas encore)
if node_modules/.bin/prisma migrate status >/dev/null 2>&1; then
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
  node_modules/.bin/prisma migrate deploy
fi

exec "$@"
