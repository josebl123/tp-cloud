# Los tres buckets privados que pidió la corrección del TP2: el sitio, los artefactos y los
# registros de acceso de los otros dos. Los tres salen del mismo módulo.
#
# El módulo configura cada bucket pero no lo crea: el SCP del Learner Lab niega una lectura que el
# provider hace después de crear cualquier `aws_s3_bucket`. Los crea el pipeline justo antes del apply
# (scripts/buckets.sh), con los nombres del output `bucket_names`, y los borra después del destroy.

module "logs_bucket" {
  source = "../modules/private-bucket"

  name                        = local.bucket_names.logs
  versioning_enabled          = false
  expiration_days             = var.access_logs_expiration_days
  additional_policy_documents = [data.aws_iam_policy_document.access_logs_delivery.json]
}

module "private_buckets" {
  source   = "../modules/private-bucket"
  for_each = local.logged_buckets

  name               = local.logged_bucket_names[each.key]
  versioning_enabled = each.value.versioning_enabled
  access_logs_prefix = "${each.key}/"

  # El output `name` del bucket de logs recién se entrega con su política puesta (la que deja a S3
  # entregar los registros): pasarlo así ordena solo eso, sin hacer esperar a todo el módulo. Su valor
  # es el nombre, que se conoce en el plan, así que el count del registro de acceso se sigue evaluando.
  access_logs_bucket = module.logs_bucket.name
}
