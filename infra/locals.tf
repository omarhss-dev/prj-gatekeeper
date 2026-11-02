locals {
  environment = "dev"

  tags = {
    project     = "gatekeeper"
    environment = local.environment
    managed_by  = "terraform"
  }
}