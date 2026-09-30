#!/usr/bin/env bash
# Prépare un VPS Ubuntu/Debian NEUF pour PharmaStock : Docker, pare-feu, mises à jour de sécurité, fuseau horaire.
# À lancer en root, une seule fois :  sudo bash migration/scripts/vps-preparer.sh
# Relançable sans risque (chaque étape vérifie d'abord ce qui est déjà fait). Ne supprime rien.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Lancez ce script en root (sudo bash …)." >&2; exit 1; fi
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "Système non prévu (${ID:-inconnu}) : Ubuntu 22.04/24.04 ou Debian 12 attendus." >&2; exit 1 ;; esac
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n== %s\n' "$*"; }

step "1/7 Mises à jour du système"
apt-get update -y
apt-get upgrade -y

step "2/7 Outils de base"
apt-get install -y ca-certificates curl git openssl ufw fail2ban unattended-upgrades cron

step "3/7 Docker Engine + Compose"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker est déjà installé : $(docker --version)"
fi
systemctl enable --now docker
# Journaux des conteneurs limités (sinon le disque se remplit en quelques mois).
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
  systemctl restart docker
fi
docker compose version

step "4/7 Pare-feu (SSH, HTTP, HTTPS uniquement)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status verbose | head -12

step "5/7 Protection contre les essais de mots de passe SSH (fail2ban)"
systemctl enable --now fail2ban

step "6/7 Mises à jour de sécurité automatiques"
dpkg-reconfigure -f noninteractive unattended-upgrades || true

step "7/7 Fuseau horaire et mémoire d'échange"
timedatectl set-timezone Africa/Tunis
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3500 ] && ! swapon --show | grep -q .; then
  echo "Mémoire ${mem_mb} Mo : création d'un fichier d'échange de 2 Go."
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat <<'FIN'

VPS prêt. Étape suivante :
  1. Le nom de domaine doit pointer vers l'adresse IP de ce serveur (enregistrement DNS « A »).
  2. cd <dossier du code>  puis  bash migration/scripts/generer-env.sh
FIN
