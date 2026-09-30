#!/usr/bin/env bash
# Vérifie qu'un déploiement PharmaStock est sain. Lecture seule, sauf la sauvegarde d'essai (option --sauvegarde).
# Usage :  bash migration/scripts/verifier-deploiement.sh [--sauvegarde]
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.production ] || { echo "KO  .env.production introuvable"; exit 2; }

DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
ko=0
ok()  { printf 'OK  %s\n' "$*"; }
bad() { printf 'KO  %s\n' "$*"; ko=1; }
val() { grep -E "^$1=" .env.production | head -1 | cut -d= -f2-; }

site=$(val SITE_ADDRESS); url=$(val APP_PUBLIC_URL)
[ "$site" = ":80" ] && base="http://localhost" || base="$url"
echo "Cible : $base"

# 1. Conteneurs
running=$($DC ps --status running --format '{{.Service}}' 2>/dev/null | sort | tr '\n' ' ')
[ "$running" = "api postgres web " ] && ok "3 conteneurs en marche (api, postgres, web)" || bad "conteneurs en marche : « $running » (attendu : api postgres web)"
unhealthy=$($DC ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -v healthy | grep -E 'unhealthy|starting' || true)
[ -z "$unhealthy" ] && ok "santé des conteneurs" || bad "conteneurs pas sains : $unhealthy"

# 2. API et site
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/v1/health" || echo 000)
[ "$code" = "200" ] && ok "API : /api/v1/health → 200" || bad "API : /api/v1/health → $code"
curl -fsS "$base/" | grep -qi '<div id="root"' && ok "site : page d'accueil servie" || bad "site : page d'accueil introuvable"
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/clients" || echo 000)
[ "$code" = "200" ] && ok "site : repli SPA (/clients → 200)" || bad "site : /clients → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/manuels/PharmaStock-Manuel-Administrateur.pdf" || echo 000)
[ "$code" = "200" ] && ok "manuels PDF servis" || bad "manuels PDF : $code"

# 3. En-têtes de sécurité et HTTPS
hdr=$(curl -sI "$base/" || true)
echo "$hdr" | grep -qi 'content-security-policy' && ok "en-tête Content-Security-Policy" || bad "Content-Security-Policy absente"
if [ "$site" != ":80" ]; then
  echo "$hdr" | grep -qi 'strict-transport-security' && ok "HSTS actif" || bad "Strict-Transport-Security absent"
  exp=$(echo | openssl s_client -servername "$site" -connect "$site:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$exp" ] && ok "certificat HTTPS valide jusqu'au $exp" || bad "certificat HTTPS illisible (DNS ? ports 80/443 ?)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://$site/" || echo 000)
  case "$code" in 301|302|307|308) ok "HTTP redirigé vers HTTPS ($code)" ;; *) bad "HTTP → $code (redirection attendue)" ;; esac
fi

# 4. Base et intégrité
$DC exec -T api node dist/src/cli.js verify-audit 2>&1 | grep -q 'Journal intègre' && ok "chaîne du mouchard intègre" || bad "vérification du mouchard"
$DC exec -T postgres psql -U pharmastock -d pharmastock -Atc "select count(*) from users" >/dev/null 2>&1 && ok "base PostgreSQL joignable" || bad "base PostgreSQL injoignable"
users=$($DC exec -T postgres psql -U pharmastock -d pharmastock -Atc "select count(*) from users" 2>/dev/null | tr -d '\r')
[ "${users:-0}" -ge 1 ] 2>/dev/null && ok "au moins un utilisateur ($users) — sinon : cli setup" || bad "aucun utilisateur : lancer « cli setup »"

# 5. Sauvegarde
if [ "${1:-}" = "--sauvegarde" ]; then
  $DC exec -T api node dist/src/cli.js backup 2>&1 | grep -q 'Sauvegarde créée' && ok "sauvegarde d'essai réussie" || bad "sauvegarde d'essai en échec"
fi

# 6. Système
disk=$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')
[ "${disk:-100}" -lt 85 ] && ok "disque : ${disk}% utilisé" || bad "disque presque plein : ${disk}%"
command -v ufw >/dev/null && (ufw status | grep -q 'Status: active' && ok "pare-feu ufw actif" || bad "pare-feu ufw inactif")
[ -n "$(val S3_BUCKET)" ] && ok "copie hors site S3 configurée" || echo "--  copie hors site S3 non configurée (recommandée : docs/EXPLOITATION.md §6)"

echo
[ "$ko" -eq 0 ] && echo "Tout est bon." || echo "Des points sont à corriger (lignes KO)."
exit "$ko"
