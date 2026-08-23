#!/usr/bin/env bash
# Empaquette l'extension en .xpi (une archive zip) dans dist/.
#
# Le .xpi produit n'est pas signé : il sert soit au chargement temporaire
# dans about:debugging, soit à l'envoi sur addons.mozilla.org pour une
# signature « self-distribution » qui rend l'installation permanente.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

version="$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')"
target="dist/synodl-${version}.xpi"

mkdir -p dist
rm -f "$target"
zip -q -r -FS "$target" manifest.json src icons \
	-x '*.DS_Store' -x '__MACOSX/*' -x 'icons/icon.svg'

printf '%s (%s)\n' "$target" "$(du -h "$target" | cut -f1)"
