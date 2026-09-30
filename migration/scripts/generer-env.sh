#!/usr/bin/env bash
# Crée .env.production avec des secrets aléatoires. Ne remplace jamais un fichier existant.
# Usage :  bash migration/scripts/generer-env.sh [domaine]     (ex. pharmacie.exemple.tn ; sans argument : question posée)
#
# Les secrets ne sont PAS affichés à l'écran (la sortie d'un terminal peut être lue par un assistant ou copiée par
# erreur). Une copie est écrite dans un fichier à part, à récupérer puis à ranger dans un gestionnaire de mots de passe.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -e .env.production ]; then echo ".env.production existe déjà : rien n'est modifié." >&2; exit 1; fi
[ -f .env.production.example ] || { echo "Lancez ce script depuis le dossier du code (.env.production.example introuvable)." >&2; exit 1; }

domain="${1:-}"
if [ -z "$domain" ]; then
  read -r -p "Nom de domaine du site (ex. pharmacie.exemple.tn), ou « : » suivi de 80 pour un essai sans domaine : " domain
fi
domain="${domain#https://}"; domain="${domain%/}"

if [ "$domain" = ":80" ]; then
  site=":80"; url="http://localhost"; secure="false"
  echo "Mode essai sans HTTPS (réseau local uniquement)."
else
  case "$domain" in *[!a-zA-Z0-9.-]*|"") echo "Nom de domaine invalide : $domain" >&2; exit 1 ;; esac
  site="$domain"; url="https://$domain"; secure=""
fi

pg=$(openssl rand -hex 24); appdb=$(openssl rand -hex 24)
jwt=$(openssl rand -base64 48 | tr -d '\n'); enc=$(openssl rand -hex 32)

umask 077
sed \
  -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$site|" \
  -e "s|^APP_PUBLIC_URL=.*|APP_PUBLIC_URL=$url|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|" \
  -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$appdb|" \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$jwt|" \
  -e "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$enc|" \
  .env.production.example > .env.production
[ "$secure" = "false" ] && sed -i 's|^# COOKIE_SECURE=false|COOKIE_SECURE=false|' .env.production
chmod 600 .env.production

keyfile="$HOME/pharmastock-secrets-A-SAUVEGARDER.txt"
{
  echo "PharmaStock — secrets du serveur ($(date -Iseconds))"
  echo "À copier dans un gestionnaire de mots de passe, puis à supprimer de ce serveur si possible."
  echo "APP_ENCRYPTION_KEY=$enc   <-- sans elle, le mot de passe SMTP et les secrets 2FA en base sont illisibles"
  echo "POSTGRES_PASSWORD=$pg"
  echo "APP_DB_PASSWORD=$appdb"
  echo "JWT_ACCESS_SECRET=$jwt"
} > "$keyfile"
chmod 600 "$keyfile"

echo ".env.production créé (droits 600)."
echo "Copie des secrets : $keyfile   (récupérez-la avec scp ; ne l'affichez pas dans une conversation)."
echo "Le mot de passe SMTP ne se met PAS dans ce fichier : il se saisit dans le site (Administration → E-mail & notifications)."
