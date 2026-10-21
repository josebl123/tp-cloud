# Una función Lambda de Queue: el bundle de esbuild se zipea, se guarda versionado en el bucket de
# artefactos y la función se crea desde ahí, con su log group y una retención definida.

data "archive_file" "this" {
  type        = "zip"
  source_file = var.source_file
  output_path = "${path.root}/.build/${var.name}.zip"
}

resource "aws_s3_object" "package" {
  bucket = var.artifacts_bucket
  key    = "lambdas/${var.name}.zip"
  source = data.archive_file.this.output_path
  etag   = data.archive_file.this.output_md5
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  description   = var.description
  role          = var.role_arn
  handler       = var.handler
  runtime       = var.runtime
  architectures = [var.architecture]
  memory_size   = var.memory_size
  timeout       = var.timeout

  s3_bucket         = aws_s3_object.package.bucket
  s3_key            = aws_s3_object.package.key
  s3_object_version = aws_s3_object.package.version_id
  source_code_hash  = data.archive_file.this.output_base64sha256

  dynamic "environment" {
    for_each = length(var.environment) > 0 ? [var.environment] : []

    content {
      variables = environment.value
    }
  }

  tags = var.tags

  # La función escribe en /aws/lambda/<nombre> por convención de nombres, no por una referencia.
  # Si se invocara antes de que exista el log group, Lambda lo crearía sin retención, y el próximo
  # apply fallaría con ResourceAlreadyExistsException al intentar crearlo.
  depends_on = [aws_cloudwatch_log_group.this]
}
