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
      lake      = "q-lake-123456789012-us-east-1"
      athena    = "q-athena-123456789012-us-east-1"
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

run "waf_protege_las_rutas_publicas" {
  command = plan

  assert {
    condition = one([
      for rule in aws_wafv2_web_acl.api.rule : rule.statement[0].rate_based_statement[0].limit
      if rule.name == "tope-rutas-publicas"
    ]) == var.waf_public_rate_limit
    error_message = "El WAF tiene que tener el tope por IP en las rutas públicas."
  }

  assert {
    condition     = length(aws_wafv2_web_acl.api.rule) == 4
    error_message = "El WAF lleva el tope por IP y los tres grupos de reglas administradas."
  }
}

run "tope_de_waf_invalido" {
  command = plan

  variables {
    waf_public_rate_limit = 5
  }

  expect_failures = [var.waf_public_rate_limit]
}

run "el_lake_recibe_solo_visitas_terminadas_particionadas_por_dia" {
  command = plan

  assert {
    condition     = jsondecode(aws_sns_topic_subscription.queues["analytics"].filter_policy).type == ["ENTRY_SERVED", "ENTRY_LEFT", "ENTRY_NO_SHOW"]
    error_message = "q-analytics recibe solo los eventos que pueden cerrar una visita."
  }

  assert {
    condition     = aws_kinesis_firehose_delivery_stream.visits.extended_s3_configuration[0].prefix == "visitas/dt=!{partitionKeyFromQuery:dt}/"
    error_message = "Firehose escribe cada visita en la carpeta de su día, que sale del propio registro."
  }

  assert {
    condition     = aws_glue_catalog_table.visits.parameters["projection.enabled"] == "true" && aws_glue_catalog_table.visits.partition_keys[0].name == "dt"
    error_message = "La tabla de hechos se particiona por dt con proyección: sin crawler ni particiones registradas a mano."
  }

  assert {
    condition     = !contains([for column in local.visit_columns : column.name], "dt")
    error_message = "dt es la partición: no puede ser además una columna de los archivos."
  }
}

run "buffer_del_lake_demasiado_corto" {
  command = plan

  variables {
    lake_buffer_seconds = 30
  }

  expect_failures = [var.lake_buffer_seconds]
}

run "el_historial_de_demo_se_carga_una_vez_por_dia" {
  command = plan

  assert {
    condition     = jsondecode(aws_lambda_invocation.seed_history[0].input).history.days == 90
    error_message = "Con los datos de demo se cargan 90 días de historial."
  }

  assert {
    condition     = join(",", keys(aws_lambda_invocation.seed_history[0].triggers)) == "dia"
    error_message = "El historial no se recarga con cada cambio del código: solo una vez por día."
  }
}

run "sin_historial" {
  command = plan

  variables {
    demo_history_days = 0
  }

  assert {
    condition     = length(aws_lambda_invocation.seed_history) == 0
    error_message = "Con 0 días no se invoca la carga del historial."
  }
}

run "athena_recalcula_el_tablero_con_un_tope_de_escaneo" {
  command = plan

  assert {
    condition     = aws_cloudwatch_event_rule.analytics_refresh.schedule_expression == "rate(5 minutes)"
    error_message = "Por defecto los agregados se recalculan cada 5 minutos."
  }

  assert {
    condition     = aws_athena_workgroup.analytics.configuration[0].bytes_scanned_cutoff_per_query == 1073741824 && aws_athena_workgroup.analytics.configuration[0].enforce_workgroup_configuration
    error_message = "El workgroup impone un tope de 1 GB por consulta, que el cliente no puede saltear."
  }

  assert {
    condition     = module.workers["analytics-refresher"].name == "q-analytics-refresher"
    error_message = "El refresher es una función más del grupo de workers."
  }
}

run "recalculo_cada_un_minuto" {
  command = plan

  variables {
    analytics_refresh_minutes = 1
  }

  assert {
    condition     = aws_cloudwatch_event_rule.analytics_refresh.schedule_expression == "rate(1 minute)"
    error_message = "EventBridge pide el singular para un minuto."
  }
}

run "tope_de_athena_invalido" {
  command = plan

  variables {
    athena_scan_limit_mb = 5
  }

  expect_failures = [var.athena_scan_limit_mb]
}
