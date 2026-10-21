# Estado remoto en S3, con el bloqueo nativo de S3 (Terraform 1.10+) en lugar de una tabla de
# DynamoDB. El bucket depende de la cuenta, así que no se escribe acá: lo pasa el pipeline con
# `terraform init -backend-config=...`, y cada cuenta del Learner Lab usa el suyo.
terraform {
  backend "s3" {
    key          = "queue/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
