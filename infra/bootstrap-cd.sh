#!/usr/bin/env bash
# Crée l'identité de déploiement de la CD (GitHub Actions -> Azure, OIDC).
# Hors de Terraform : elle doit survivre à un destroy, sinon son client_id
# change à chaque reconstruction et les variables GitHub deviennent fausses.
# À lancer une fois par abonnement, après bootstrap-state.sh. Relançable.
set -euo pipefail

RG="rg-gatekeeper-state"            # hors du périmètre détruit (ADR-044)
IDENTITY="id-gatekeeper-cd"
REPO="omarhss-dev/prj-gatekeeper"   # casse exacte : le sujet est comparé tel quel
BRANCH="main"

# Même région que le groupe, plutôt qu'un paramètre qui pourrait diverger
LOCATION="$(az group show -n "$RG" --query location -o tsv)"

az identity create -n "$IDENTITY" -g "$RG" -l "$LOCATION" -o none

# Azure n'accepte un jeton GitHub que si ces trois valeurs correspondent.
# Seul un run sur refs/heads/main de ce dépôt présente ce sujet :
# une PR présente "...:pull_request" et n'obtient aucun jeton.
az identity federated-credential create \
  --name "github-$BRANCH" \
  --identity-name "$IDENTITY" -g "$RG" \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:$REPO:ref:refs/heads/$BRANCH" \
  --audiences "api://AzureADTokenExchange" \
  -o none

CLIENT_ID="$(az identity show -n "$IDENTITY" -g "$RG" --query clientId -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
SUB_ID="$(az account show --query id -o tsv)"
# Une commande qui réussit en renvoyant du vide ne fait pas échouer set -e (INC-026)
: "${CLIENT_ID:?clientId vide}" "${TENANT_ID:?tenantId vide}" "${SUB_ID:?id vide}"

echo "Variables GitHub (des identifiants, pas des secrets) :"
echo "gh variable set AZURE_CLIENT_ID --body \"$CLIENT_ID\""
echo "gh variable set AZURE_TENANT_ID --body \"$TENANT_ID\""
echo "gh variable set AZURE_SUBSCRIPTION_ID --body \"$SUB_ID\""