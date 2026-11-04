# Identité de la CD : créée par bootstrap-cd.sh, hors du périmètre détruit,
# pour que son client_id survive à un destroy. Terraform la lit seulement,
# et lui donne des droits sur les ressources qu'il crée (elles, détruites).
data "azurerm_user_assigned_identity" "cd" {
  name                = "id-gatekeeper-cd"
  resource_group_name = "rg-gatekeeper-state"
}

# Pousser les images. Le tirage par l'application passe par sa propre
# identité (AcrPull, ADR-045) : la CD n'en a pas besoin.
resource "azurerm_role_assignment" "cd_acr_push" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPush"
  principal_id         = data.azurerm_user_assigned_identity.cd.principal_id
  principal_type       = "ServicePrincipal"
}

# Rôle personnalisé, actions listées une par une : pas de joker, parce que
# Microsoft.App/containerApps/* inclut listSecrets, qui renvoie les valeurs
# résolues des références Key Vault (mesuré, E2).
resource "azurerm_role_definition" "deployer" {
  name        = "gatekeeper-deployer-${local.environment}"
  scope       = azurerm_resource_group.main.id
  description = "Deploiement des images GateKeeper, sans lecture des secrets"

  permissions {
    actions = [
      "Microsoft.App/containerApps/read",
      "Microsoft.App/containerApps/write",
      "Microsoft.App/containerApps/revisions/read",
      # Modifier une application de l'environnement exige ce droit sur l'environnement
      "Microsoft.App/managedEnvironments/read",
      "Microsoft.App/managedEnvironments/join/action",

      # Job de migration : changer son image, le démarrer, suivre ses exécutions.
      # Pas de jobs/listSecrets, pour la même raison que l'application (E2).
      "Microsoft.App/jobs/read",
      "Microsoft.App/jobs/write",
      "Microsoft.App/jobs/start/action",
      "Microsoft.App/jobs/executions/read",
    ]
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

resource "azurerm_role_assignment" "cd_deployer" {
  scope              = azurerm_resource_group.main.id
  role_definition_id = azurerm_role_definition.deployer.role_definition_resource_id
  principal_id       = data.azurerm_user_assigned_identity.cd.principal_id
  principal_type     = "ServicePrincipal"
}
