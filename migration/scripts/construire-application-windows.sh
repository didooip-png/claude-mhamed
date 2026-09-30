#!/usr/bin/env bash
# Construit l'application PharmaStock pour Windows, DEPUIS LE VPS LINUX (aucun ordinateur Windows ni GitHub requis).
#
#   bash migration/scripts/construire-application-windows.sh                # dossier portable .zip (recommandé, sans Wine)
#   bash migration/scripts/construire-application-windows.sh --installateur # installateur .exe (NSIS) : demande Wine
#
# Résultat : apps/desktop/release/PharmaStock-<version>-win-x64.zip  (ou PharmaStock-Setup-<version>.exe)
# Prérequis : Node.js 22 et pnpm (corepack enable), ~3 Go de disque libres, accès Internet (téléchargement d'Electron).
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="zip"
[ "${1:-}" = "--installateur" ] && mode="nsis"

command -v node >/dev/null || { echo "Node.js est absent. Installez Node 22 (ex. : curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs)." >&2; exit 1; }
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 22 ] || { echo "Node.js $node_major détecté : la version 22 ou plus est requise." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm est absent : lancez « sudo corepack enable » puis relancez ce script." >&2; exit 1; }

if [ "$mode" = "nsis" ] && ! command -v wine >/dev/null; then
  cat >&2 <<'MSG'
L'installateur .exe (NSIS) se construit avec Wine sous Linux, et Wine n'est pas installé.
  - Ubuntu : sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install -y wine wine32 wine64
  - ou, sans rien installer : relancez SANS l'option --installateur (dossier portable .zip, même application).
MSG
  exit 1
fi

echo "== 1/4 Dépendances"
pnpm install --frozen-lockfile
echo "== 2/4 Compilation de l'application et du site local"
pnpm --filter @pharmastock/desktop build
pnpm --filter @pharmastock/desktop build:renderer
echo "== 3/4 Paquet Windows ($mode)"
cd apps/desktop
rm -rf release
extra=()
# Sans Wine, on ne peut pas modifier les ressources de l'exécutable (icône, informations de version) : la construction
# reste complète et fonctionnelle. Avec Wine, tout est appliqué.
command -v wine >/dev/null || extra+=(-c.win.signAndEditExecutable=false)
pnpm exec electron-builder --win "$mode" --x64 --publish never "${extra[@]}"

echo "== 4/4 Résultat"
out=$(ls release/PharmaStock-* 2>/dev/null | grep -E '\.(zip|exe)$' | head -1)
[ -n "$out" ] || { echo "Aucun paquet produit : voir les messages ci-dessus." >&2; exit 1; }
sha256sum "$out" | tee "$out.sha256"
ls -lh "$out"
cat <<FIN

Récupérez le fichier sur votre PC :   scp root@ADRESSE_IP:$(pwd)/$out .
Installation sur un poste de caisse Windows : voir docs/DESKTOP.md (« Installer sur un poste »).
FIN
