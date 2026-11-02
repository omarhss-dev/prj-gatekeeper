resource "azurerm_role_assignment" "deployer_secrets_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_secret" "db_password" {
  name             = "db-admin-password"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.db.result
  value_wo_version = 1
  depends_on       = [azurerm_role_assignment.deployer_secrets_officer]
}

ephemeral "random_password" "jwt" {
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "jwt_secret" {
  name             = "jwt-secret"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.jwt.result
  value_wo_version = 1
  depends_on       = [azurerm_role_assignment.deployer_secrets_officer]
}