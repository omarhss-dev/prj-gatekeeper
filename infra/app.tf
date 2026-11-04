resource "azurerm_resource_group_template_deployment" "cae" {
  name                = "cae-gatekeeper-${local.environment}-001"
  resource_group_name = azurerm_resource_group.main.name
  deployment_mode     = "Incremental"
  tags                = local.tags

  parameters_content = jsonencode({
    name        = { value = "cae-gatekeeper-${local.environment}-001" }
    location    = { value = azurerm_resource_group.main.location }
    workspaceId = { value = azurerm_log_analytics_workspace.main.id }
    tags        = { value = local.tags }
  })

  template_content = jsonencode({
    "$schema"      = "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#"
    contentVersion = "1.0.0.0"
    parameters = {
      name        = { type = "String" }
      location    = { type = "String" }
      workspaceId = { type = "String" }
      tags        = { type = "Object" }
    }
    resources = [
      {
        type       = "Microsoft.App/managedEnvironments"
        apiVersion = "2026-07-01"
        name       = "[parameters('name')]"
        location   = "[parameters('location')]"
        tags       = "[parameters('tags')]"
        properties = {
          environmentMode = "WorkloadProfiles"
          workloadProfiles = [
            {
              name                = "Consumption"
              workloadProfileType = "Consumption"
            }
          ]
          appLogsConfiguration = {
            destination = "log-analytics"
            logAnalyticsConfiguration = {
              customerId = "[reference(parameters('workspaceId'), '2022-10-01').customerId]"
              sharedKey  = "[listKeys(parameters('workspaceId'), '2022-10-01').primarySharedKey]"
            }
          }
        }
      }
    ]
    outputs = {
      id = {
        type  = "String"
        value = "[resourceId('Microsoft.App/managedEnvironments', parameters('name'))]"
      }
    }
  })
}

resource "azurerm_container_app" "api" {
  name                         = "ca-gatekeeper-api-${local.environment}"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = jsondecode(azurerm_resource_group_template_deployment.cae.output_content).id.value
  revision_mode                = "Single"

  workload_profile_name = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "database-url"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.database_url.versionless_id
  }

  secret {
    name                = "jwt-secret"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.jwt_secret.versionless_id
  }

  ingress {
    external_enabled = true
    target_port      = 3000

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    # Invariant ADR-007 : max_replicas × pool.max (10) + 1 (migration) ≤ 30.
    max_replicas = 2

    container {
      name = "api"
      # Image de remplacement : le déploiement manuel puis le CD posent l'image réelle,
      # taguée par SHA. Voir ignore_changes plus bas.
      image  = "mcr.microsoft.com/k8se/quickstart:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "JWT_TTL_SECONDS"
        value = "3600"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/health/live"
        initial_delay           = 5
        interval_seconds        = 10
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/health/ready"
        initial_delay           = 3
        interval_seconds        = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [
    azurerm_role_assignment.app_acr_pull,
    azurerm_role_assignment.app_key_vault_secrets_user,
  ]
}

# Job de migration (ADR-021, ADR-040) : déclenché à la demande par la CD, avant la
# mise à jour de l'application. Il tourne dans l'environnement, avec l'identité
# de l'application : la CD ne voit jamais l'URL de la base.
resource "azurerm_container_app_job" "migrate" {
  name                         = "caj-gatekeeper-migrate-${local.environment}"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = jsondecode(azurerm_resource_group_template_deployment.cae.output_content).id.value
  workload_profile_name        = "Consumption"

  # Le premier démarrage d'une révision de l'API a dépassé 120 s, et l'image
  # migrate est plus lourde (devDependencies). Large d'abord, resserré après mesure.
  replica_timeout_in_seconds = 600
  # Une erreur SQL échouerait pareil au second essai : un échec doit se voir tout de suite.
  replica_retry_limit = 0

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "database-url"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.database_url.versionless_id
  }

  template {
    container {
      name = "migrate"
      # Remplacement, comme pour l'application (ADR-050) : la CD pose l'image réelle.
      image  = "mcr.microsoft.com/k8se/quickstart:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [
    azurerm_role_assignment.app_acr_pull,
    azurerm_role_assignment.app_key_vault_secrets_user,
  ]
}