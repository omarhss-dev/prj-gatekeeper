#!/usr/bin/env bash
# Crée le stockage du state Terraform. À lancer une fois par abonnement.
# Terraform ne peut pas créer le conteneur qui contiendra son propre state.
set -euo pipefail
# -e : s'arrêter à la première commande en échec
# -u : variable non définie = erreur (évite une faute de frappe silencieuse)
# pipefail : un échec au milieu d'un pipe n'est pas masqué

LOCATION="${1:?usage: $0 <région>}"   # ex. spaincentral, jamais en dur
RG="rg-gatekeeper-state"              # séparé du groupe que destroy détruira
CONTAINER="tfstate"

SUB_ID="$(az account show --query id -o tsv)"
# Nom déterministe : même abonnement, même compte, donc le script est relançable.
# Le dépôt est public : l'identifiant n'est jamais écrit, seulement son hash.
ACCOUNT="gkstate$(printf '%s' "$SUB_ID" | sha256sum | cut -c1-8)"   # 15 caractères

az group create -n "$RG" -l "$LOCATION" -o none

az storage account create \
  -n "$ACCOUNT" -g "$RG" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --allow-shared-key-access false \
  -o none

# Versioning : si le state est corrompu ou écrasé, l'ancienne version se récupère
az storage account blob-service-properties update \
  --account-name "$ACCOUNT" -g "$RG" \
  --enable-versioning true -o none

# Plan de contrôle (ARM) : Owner ne donne aucun droit sur les données des blobs
az storage container-rm create \
  --storage-account "$ACCOUNT" -g "$RG" -n "$CONTAINER" -o none

# Rôle de données au niveau du conteneur, pas du compte (moindre privilège)
USER_ID="$(az ad signed-in-user show --query id -o tsv)"
SCOPE="/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$ACCOUNT/blobServices/default/containers/$CONTAINER"
az role assignment create \
  --assignee-object-id "$USER_ID" --assignee-principal-type User \
  --role "Storage Blob Data Contributor" --scope "$SCOPE" -o none

echo "À copier dans infra/backend.hcl :"
echo "resource_group_name  = \"$RG\""
echo "storage_account_name = \"$ACCOUNT\""
echo "container_name       = \"$CONTAINER\""
echo "key                  = \"dev.tfstate\""