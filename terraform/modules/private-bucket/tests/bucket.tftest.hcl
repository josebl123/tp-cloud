# Lo que el módulo promete, en modo plan y sin AWS: `terraform test` en esta carpeta.

mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{}"
    }
  }
}

variables {
  name = "q-prueba-123456789012-us-east-1"
}

run "lo_que_tiene_todo_bucket" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.this.block_public_acls,
      aws_s3_bucket_public_access_block.this.block_public_policy,
      aws_s3_bucket_public_access_block.this.ignore_public_acls,
      aws_s3_bucket_public_access_block.this.restrict_public_buckets,
    ])
    error_message = "Todo bucket bloquea el acceso público, las cuatro opciones."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.this.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Sin ACLs: los objetos son siempre de la cuenta."
  }

  assert {
    condition     = output.arn == "arn:aws:s3:::q-prueba-123456789012-us-east-1" && output.name == var.name
    error_message = "El módulo configura el bucket que recibe: el nombre es el mismo y el ARN sale de él."
  }

  assert {
    condition     = length(aws_s3_bucket_versioning.this) == 1
    error_message = "El versionado está prendido por defecto."
  }

  assert {
    condition     = length(aws_s3_bucket_logging.this) == 0 && length(aws_s3_bucket_lifecycle_configuration.this) == 0
    error_message = "Sin destino de registros ni expiración, no se crean."
  }
}

run "con_registros_de_acceso_y_expiracion" {
  command = plan

  variables {
    versioning_enabled = false
    access_logs_bucket = "q-logs-123456789012-us-east-1"
    access_logs_prefix = "spa/"
    expiration_days    = 30
  }

  assert {
    condition     = aws_s3_bucket_logging.this[0].target_bucket == "q-logs-123456789012-us-east-1" && aws_s3_bucket_logging.this[0].target_prefix == "spa/"
    error_message = "Los registros van al bucket y al prefijo pedidos."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.this[0].rule[0].expiration[0].days == 30
    error_message = "La expiración usa los días pedidos."
  }

  assert {
    condition     = length(aws_s3_bucket_versioning.this) == 0
    error_message = "Sin versionado, no se crea su configuración."
  }
}

run "expiracion_no_entera" {
  command = plan

  variables {
    expiration_days = 1.5
  }

  expect_failures = [var.expiration_days]
}
