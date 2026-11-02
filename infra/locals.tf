locals {
  environment = "dev"
  suffix      = substr(sha256(data.azurerm_client_config.current.subscription_id), 0, 8)

  tags = {
    project     = "gatekeeper"
    environment = local.environment
    managed_by  = "terraform"
  }
}