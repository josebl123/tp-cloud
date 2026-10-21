# La configuración entera en modo plan, sin AWS: `terraform test` en terraform/organization.
# Comprueba que el plan se puede armar (los count y for_each se conocen antes del apply) y algunas
# decisiones de la raíz. Las de cada módulo están en terraform/modules/*/tests.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_region" {
    defaults = {
      region = "us-east-1"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/LabRole"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{}"
    }
  }
}

mock_provider "archive" {
  mock_data "archive_file" {
    defaults = {
      output_md5          = "d41d8cd98f00b204e9800998ecf8427e"
      output_base64sha256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    }
  }
}

mock_provider "random" {}

variables {
  # Sin el build del sitio: fileset devuelve un conjunto vacío y no se sube nada.
  site_dir = "tests/sin-sitio"
}

run "el_plan_se_arma_con_los_valores_por_defecto" {
  command = plan

  assert {
    condition = output.bucket_names == {
      spa       = "q-spa-123456789012-us-east-1"
      artifacts = "q-artifacts-123456789012-us-east-1"
      logs      = "q-logs-123456789012-us-east-1"
    }
    error_message = "Los nombres de los buckets salen de la cuenta y la región, y se conocen en el plan (el pipeline los lee del plan para crearlos)."
  }

  assert {
    condition     = aws_lambda_event_source_mapping.stream.starting_position == "TRIM_HORIZON"
    error_message = "El stream se lee desde TRIM_HORIZON: con LATEST, un mapping recién creado pierde lo que se escribe mientras arranca."
  }

  assert {
    condition     = length(aws_secretsmanager_secret.smtp) == 0 && length(aws_sesv2_email_identity.sender) == 0
    error_message = "Sin remitente configurado no hay secreto SMTP ni identidad de SES: los avisos se simulan."
  }

  assert {
    condition     = aws_api_gateway_stage.this.stage_name == "prod"
    error_message = "El stage por defecto es el que espera el frontend del pipeline."
  }
}

run "con_el_smtp_de_gmail" {
  command = plan

  variables {
    smtp_sender_email = "grupo@example.com"
  }

  assert {
    condition     = aws_secretsmanager_secret.smtp[0].recovery_window_in_days == 0
    error_message = "El secreto se borra sin ventana de recuperación, para que un apply después de un destroy pueda recrearlo."
  }

  assert {
    condition     = output.smtp_sender_email == "grupo@example.com"
    error_message = "La prueba de humo lee el remitente de este output."
  }
}

run "concurrencia_no_entera" {
  command = plan

  variables {
    consumer_max_concurrency = 2.5
  }

  expect_failures = [var.consumer_max_concurrency]
}

run "rutas_anonimas_con_un_techo_mayor_que_la_api" {
  command = plan

  variables {
    public_write_rate_limit = 100
  }

  expect_failures = [var.public_write_rate_limit]
}

run "email_de_alertas_invalido" {
  command = plan

  variables {
    alert_email = "no-es-un-mail"
  }

  expect_failures = [var.alert_email]
}
