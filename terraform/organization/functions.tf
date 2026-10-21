# Las funciones, en dos grupos (locals.tf explica por qué). El trigger de Cognito va aparte, en
# auth.tf, por el mismo motivo.

module "api_functions" {
  source   = "../modules/lambda-function"
  for_each = local.api_functions

  name               = format("%s-%s", var.project, each.key)
  description        = each.value.description
  source_file        = "${var.functions_dist_dir}/${each.key}/index.mjs"
  memory_size        = each.value.memory_size
  timeout            = each.value.timeout
  environment        = each.value.environment
  role_arn           = data.aws_iam_role.lab.arn
  artifacts_bucket   = module.private_buckets["artifacts"].name
  log_retention_days = var.log_retention_days
}

module "workers" {
  source   = "../modules/lambda-function"
  for_each = local.workers

  name               = format("%s-%s", var.project, each.key)
  description        = each.value.description
  source_file        = "${var.functions_dist_dir}/${each.key}/index.mjs"
  memory_size        = each.value.memory_size
  timeout            = each.value.timeout
  environment        = each.value.environment
  role_arn           = data.aws_iam_role.lab.arn
  artifacts_bucket   = module.private_buckets["artifacts"].name
  log_retention_days = var.log_retention_days
}

# Cada consumidor lee su cola. Con la concurrencia de Lambda limitada en el lab, cada uno tiene un
# techo propio: un pico de avisos no puede dejar sin ejecuciones a la API ni al push en vivo.
resource "aws_lambda_event_source_mapping" "consumers" {
  for_each = local.consumers

  event_source_arn = module.queues[each.value.queue].arn
  function_name    = module.workers[each.key].arn
  batch_size       = each.value.batch_size

  # Solo vuelven a la cola los mensajes que fallaron, no el lote entero.
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.consumer_max_concurrency
  }
}
