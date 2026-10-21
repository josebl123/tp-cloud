# Lo que el módulo promete, en modo plan y sin AWS: `terraform test` en esta carpeta.

mock_provider "aws" {}

mock_provider "archive" {
  mock_data "archive_file" {
    defaults = {
      output_md5          = "d41d8cd98f00b204e9800998ecf8427e"
      output_base64sha256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    }
  }
}

variables {
  name             = "q-prueba"
  source_file      = "dist/q-prueba/index.mjs"
  role_arn         = "arn:aws:iam::123456789012:role/LabRole"
  artifacts_bucket = "q-artifacts-123456789012-us-east-1"
}

run "funcion_desde_su_zip_versionado" {
  command = plan

  assert {
    condition     = aws_s3_object.package.key == "lambdas/q-prueba.zip" && aws_s3_object.package.bucket == var.artifacts_bucket
    error_message = "El zip va al bucket de artefactos, con el nombre de la función."
  }

  assert {
    condition     = aws_lambda_function.this.s3_key == aws_s3_object.package.key
    error_message = "La función se crea desde ese zip."
  }

  assert {
    condition     = aws_cloudwatch_log_group.this.name == "/aws/lambda/q-prueba" && aws_cloudwatch_log_group.this.retention_in_days == 14
    error_message = "El log group es el que usa Lambda por convención, con retención."
  }

  assert {
    condition     = aws_lambda_function.this.runtime == "nodejs22.x" && aws_lambda_function.this.architectures == tolist(["arm64"])
    error_message = "Node 22 en arm64 por defecto."
  }

  assert {
    condition     = length(aws_lambda_function.this.environment) == 0
    error_message = "Sin variables de entorno no hay bloque environment."
  }
}

run "con_variables_de_entorno" {
  command = plan

  variables {
    environment = { TABLE_NAME = "q-main" }
  }

  assert {
    condition     = aws_lambda_function.this.environment[0].variables["TABLE_NAME"] == "q-main"
    error_message = "Las variables de entorno llegan a la función."
  }
}

run "memoria_no_entera" {
  command = plan

  variables {
    memory_size = 256.5
  }

  expect_failures = [var.memory_size]
}

run "retencion_que_cloudwatch_no_acepta" {
  command = plan

  variables {
    log_retention_days = 10
  }

  expect_failures = [var.log_retention_days]
}
