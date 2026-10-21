#!/usr/bin/env bash
# Publica uma versão DESTE fork: cria a tag, a release do GitHub e dispara o
# build das imagens no GHCR do dono do fork. É a release que o
# `update.sh` da VPS enxerga (ele pergunta releases/latest ao `origin`).
#
# Uso: bash .fork/publicar.sh            (no Actions, com GH_TOKEN)
#      PUBLICAR_SECO=1 bash .fork/publicar.sh   (só mostra o que faria)
#
# Recusa publicar quando a main carrega código do original que ainda não saiu
# em versão lançada — o fork só entrega versões do original, nunca o meio do
# caminho entre duas.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comum.sh
source "$DIR/comum.sh"

if [ "${GITHUB_EVENT_NAME:-}" = "push" ] && ! git cat-file -e "HEAD^1:${ARQ_VERSAO}" 2>/dev/null; then
  echo "::notice::Estrutura do fork instalada agora. A primeira versão do fork é publicada na primeira sincronização com o original."
  exit 0
fi

buscar_original
git fetch --quiet --tags origin

base="$(versao_incorporada)"
git rev-parse -q --verify "refs/upstream-tags/${base}" >/dev/null \
  || { echo "::error::${ARQ_VERSAO} diz ${base}, mas essa versão não existe no original."; exit 1; }

pendentes="$(commits_nao_lancados HEAD "$base")"
if [ -n "$pendentes" ]; then
  n="$(printf '%s\n' "$pendentes" | grep -c .)"
  echo "::error::A main contém ${n} commit(s) do original que ainda NÃO saíram em versão lançada (depois de ${base})."
  echo "::error::Publicar agora entregaria código não lançado. Espere a próxima sincronização semanal — ela traz a versão que contém esses commits."
  exit 1
fi

ja="$(git tag --points-at HEAD -l 'v*' | awk 'NR == 1')"
retomando=""
if [ -n "$ja" ]; then
  if gh release view "$ja" >/dev/null 2>&1; then
    echo "Este commit já foi publicado como ${ja}. Nada a fazer."
    exit 0
  fi
  # Tag criada numa execução que morreu antes da release: retoma dali.
  tag="$ja"; retomando=1
  anterior="$(git tag -l 'v*' --sort=-v:refname | grep -vx "$ja" | awk 'NR == 1')"
else
  tag="$(proxima_tag_livre "$base")"
  anterior="$(git tag -l 'v*' --sort=-v:refname | awk 'NR == 1')"
fi

{
  if [ "$tag" = "$base" ]; then
    echo "Versão **${base#v}** do original, com as modificações deste fork."
  else
    echo "Correção deste fork sobre a versão **${base#v}** do original."
  fi
  echo
  echo "- Novidades do original: [CHANGELOG da ${base}](https://github.com/${UPSTREAM_REPO}/blob/${base}/CHANGELOG.md)"
  echo "- Imagens: \`${IMG_NAMESPACE}/${IMAGEM_PRINCIPAL}:${tag#v}\` (e as demais imagens do projeto)"
  echo
  echo "### Mudanças deste fork desde ${anterior:-o início}"
  echo
  # Exclusões como `^ref`: dois `--not` seguidos se anulariam.
  excluir=("^refs/remotes/upstream/main")
  [ -n "$anterior" ] && excluir+=("^${anterior}")
  while read -r r; do excluir+=("^${r}"); done < <(git for-each-ref --format='%(refname)' 'refs/upstream-tags/')
  git log --no-merges --format='- %s (%h)' HEAD "${excluir[@]}" | awk 'NR <= 50'
  echo
  echo "Para atualizar a VPS: \`${COMANDO_ATUALIZAR_VPS}\`"
} > /tmp/notas-da-release.md

echo "Publicando ${tag} (base: ${base})"
cat /tmp/notas-da-release.md

if [ -n "${PUBLICAR_SECO:-}" ]; then
  echo "(modo seco: nada foi criado)"
  exit 0
fi

if [ -z "$retomando" ]; then
  configurar_autor_bot
  git tag -a "$tag" -m "Fork ${FORK_REPO}: ${tag} (original ${base})"
  git push origin "refs/tags/${tag}"
fi

# A tag empurrada com a FORK_TOKEN dispara o workflow de imagens sozinha (push de
# tag). Se o build não aparecer — ex.: execução retomada, tag já existia —, ele
# é disparado à mão.
inicio="$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)"
achar_build() {
  gh run list --workflow "$WORKFLOW_IMAGENS" --branch "$tag" --limit 5 \
    --json databaseId,createdAt --jq "[.[] | select(.createdAt >= \"${inicio}\")][0].databaseId // empty"
}
run_id=""
for _ in $(seq 1 12); do
  run_id="$(achar_build)"; [ -n "$run_id" ] && break
  sleep 10
done
if [ -z "$run_id" ]; then
  echo "O build não começou sozinho; disparando."
  gh workflow run "$WORKFLOW_IMAGENS" --ref "$tag"
  for _ in $(seq 1 18); do
    run_id="$(achar_build)"; [ -n "$run_id" ] && break
    sleep 10
  done
fi
[ -n "$run_id" ] || { echo "::error::Não achei o build das imagens de ${tag}. A tag existe, a release NÃO foi criada."; exit 1; }

echo "Aguardando o build das imagens (run ${run_id}) — leva uns 15 a 25 minutos."
if ! gh run watch "$run_id" --exit-status --interval 60 >/dev/null; then
  echo "::error::O build das imagens de ${tag} falhou: https://github.com/${FORK_REPO}/actions/runs/${run_id}"
  echo "::error::A tag existe, mas a release NÃO foi criada — a VPS continua vendo a versão anterior."
  exit 1
fi

gh release create "$tag" --title "${tag}" --notes-file /tmp/notas-da-release.md --latest
echo "Versão ${tag} publicada. Na VPS: ${COMANDO_ATUALIZAR_VPS}"
