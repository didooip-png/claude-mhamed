#!/usr/bin/env bash
# Fabrique le dossier de migration téléchargeable (à lancer sur la machine de développement, dépôt propre) :
#   bash migration/scripts/make-bundle.sh
# Résultat dans migration-out/ : dossier PharmaStock-migration-AAAAMMJJ/, + .zip + .tar.gz.
# Contenu : LISEZMOI, guide pour Claude Code, message de démarrage, code (fichiers versionnés uniquement,
# donc sans .env ni node_modules), historique Git complet (bundle), version, historique, empreintes SHA-256.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Le dépôt a des modifications non validées : faites un commit d'abord (le dossier reproduit HEAD)." >&2
  exit 1
fi

stamp=$(date +%Y%m%d)
name="PharmaStock-migration-$stamp"
out="migration-out"
dir="$out/$name"
rm -rf "$dir" "$out/$name.zip" "$out/$name.tar.gz"
mkdir -p "$dir/code"

# 1. Documents pour le propriétaire et pour Claude Code, en tête du dossier
cp migration/LISEZMOI.md migration/CONTEXTE_CLAUDE_CODE.md migration/PROMPT_CLAUDE_CODE.txt "$dir/"

# 2. Le code : uniquement les fichiers versionnés
git archive HEAD | tar -x -C "$dir/code"

# 3. Historique complet (permet de recréer le dépôt : git clone PharmaStock.git.bundle pharmastock)
git bundle create "$dir/PharmaStock.git.bundle" --all >/dev/null 2>&1

# 4. Version et historique lisible
{
  echo "PharmaStock — dossier de migration"
  echo "Date         : $(date -Iseconds)"
  echo "Commit       : $(git rev-parse HEAD)"
  echo "Branche      : $(git rev-parse --abbrev-ref HEAD)"
  echo "Dépôt        : $(git remote get-url origin 2>/dev/null || echo 'inconnu')"
} > "$dir/VERSION.txt"
git log --date=short --pretty='%h %ad %s' > "$dir/HISTORIQUE.txt"
cp "$dir/HISTORIQUE.txt" "$dir/code/migration/HISTORIQUE.txt"
cp "$dir/VERSION.txt" "$dir/code/migration/VERSION.txt"

# 5. Contrôle : aucun secret ne doit se trouver dans l'archive
if grep -rIlE '(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})' "$dir/code" >/dev/null 2>&1; then
  echo "ALERTE : un secret potentiel figure dans le code archivé. Dossier non finalisé." >&2
  grep -rIlE '(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})' "$dir/code" >&2
  exit 1
fi
if find "$dir/code" -name '.env' -o -name '.env.production' | grep -q .; then
  echo "ALERTE : un fichier .env figure dans l'archive." >&2
  exit 1
fi

# 6. Empreintes puis archives
(cd "$dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar -czf "$out/$name.tar.gz" -C "$out" "$name"
(cd "$out" && zip -qr "$name.zip" "$name")

echo "Dossier : $dir"
ls -lh "$out/$name.zip" "$out/$name.tar.gz"
