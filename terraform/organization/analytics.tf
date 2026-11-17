# La analítica: un ETL en streaming de la operación (OLTP) a una tabla de hechos en un data lake, y
# un motor (Athena) que la resume para el tablero del panel.
#
#   SNS q-queue-events ─▶ SQS q-analytics ─▶ λ archiver ─▶ Firehose q-visitas ─▶ S3 lake (Parquet, por día)
#                                                                  │                    │
#                                       Glue Data Catalog ◀────────┘                    │
#                                              │                                         │
#   EventBridge (cada N min) ─▶ λ analytics-refresher ─▶ Athena ◀─────────────────────────┘
#                                              │
#                                              └─▶ DynamoDB q-main (agregados por día) ─▶ λ staff ─▶ panel
#
# DynamoDB está modelada para la operación: leer y cambiar una cola por su clave, en milisegundos.
# Las preguntas del negocio ("¿a qué hora se llena?", "¿cuánto le erramos a la espera?") son lo
# opuesto: recorren meses de visitas terminadas de todas las colas. En lugar de escanear la tabla de
# la operación, cada visita que termina se copia una sola vez, ya transformada, a una tabla de hechos:
#
#   - extracción y transformación: el archiver lee la entrada terminada y arma su fila (functions/src/
#     analytics/fact.ts), con las duraciones y la hora local ya calculadas;
#   - carga: Firehose junta las filas, las convierte a Parquet (columnar y comprimido: una consulta lee
#     solo las columnas que usa) y las escribe particionadas por día local, así una consulta de "la
#     última semana" lee siete carpetas y no el lake entero;
#   - catálogo: la tabla de Glue es el esquema de esos archivos. Firehose lo usa para convertir, y
#     Athena para consultarlos sin moverlos de S3 (schema-on-read).
#
# Athena calcula, pero no atiende al panel: responde en segundos y cobra por dato escaneado. Cada
# pocos minutos el refresher le pide un resumen por local, día y cola y lo guarda en DynamoDB; el
# tablero lee de ahí (functions/src/analytics/aggregates.ts). Para preguntas que el tablero no
# contesta, la tabla se consulta directamente con SQL desde la consola de Athena, con el mismo workgroup.

locals {
  # El rango más largo del tablero: el refresher recalcula estos días en cada vuelta.
  analytics_window_days = 90

  analytics_database = replace(format("%s_analitica", var.project), "-", "_")
  visits_table       = "visitas"
  visits_location    = format("s3://%s/%s/", local.bucket_names.lake, local.visits_table)

  # Las columnas de la tabla de hechos, en el orden de VisitFact (functions/src/analytics/fact.ts). Si
  # cambia una, cambia la otra. `dt` no está: es la partición, y sale de la ruta del archivo.
  visit_columns = [
    { name = "visit_id", type = "string", comment = "Id de la entrada: una visita puede llegar dos veces." },
    { name = "establishment_id", type = "string", comment = "" },
    { name = "establishment_name", type = "string", comment = "" },
    { name = "queue_id", type = "string", comment = "" },
    { name = "queue_name", type = "string", comment = "" },
    { name = "lane_id", type = "string", comment = "" },
    { name = "lane_name", type = "string", comment = "" },
    { name = "party_size", type = "int", comment = "" },
    { name = "outcome", type = "string", comment = "SERVED, LEFT o NO_SHOW." },
    { name = "no_show_policy", type = "string", comment = "" },
    { name = "no_show_count", type = "int", comment = "" },
    { name = "joined_at", type = "timestamp", comment = "UTC." },
    { name = "called_at", type = "timestamp", comment = "UTC. Vacío si nunca lo llamaron." },
    { name = "serving_started_at", type = "timestamp", comment = "UTC." },
    { name = "finished_at", type = "timestamp", comment = "UTC." },
    { name = "wait_seconds", type = "int", comment = "De anotarse a ser llamado." },
    { name = "time_in_line_seconds", type = "int", comment = "De anotarse a terminar." },
    { name = "service_seconds", type = "int", comment = "Solo los atendidos." },
    { name = "estimated_wait_seconds", type = "int", comment = "La espera que se le mostró al anotarse." },
    { name = "local_date", type = "string", comment = "Día local de llegada (AAAA-MM-DD)." },
    { name = "local_hour", type = "int", comment = "Hora local de llegada, 0 a 23." },
    { name = "local_weekday", type = "int", comment = "1 = lunes … 7 = domingo." },
  ]
}

resource "aws_glue_catalog_database" "analytics" {
  name        = local.analytics_database
  description = "Data lake de Queue: los hechos de la operación, para análisis."
}

resource "aws_glue_catalog_table" "visits" {
  database_name = aws_glue_catalog_database.analytics.name
  name          = local.visits_table
  description   = "Tabla de hechos: una fila por visita terminada."
  table_type    = "EXTERNAL_TABLE"

  # Proyección de particiones: las particiones se calculan a partir de la fecha en lugar de
  # registrarse una por una. No hace falta un crawler ni un ALTER TABLE ADD PARTITION por día.
  parameters = {
    classification                = "parquet"
    EXTERNAL                      = "TRUE"
    "projection.enabled"          = "true"
    "projection.dt.type"          = "date"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.range"         = "NOW-2YEARS,NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "${local.visits_location}dt=$${dt}/"
  }

  partition_keys {
    name    = "dt"
    type    = "string"
    comment = "Día local en que terminó la visita (AAAA-MM-DD)."
  }

  storage_descriptor {
    location      = local.visits_location
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters            = { "serialization.format" = "1" }
    }

    dynamic "columns" {
      for_each = local.visit_columns

      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}

resource "aws_cloudwatch_log_group" "visits_delivery" {
  name              = format("/aws/kinesisfirehose/%s-visitas", var.project)
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_stream" "visits_delivery" {
  name           = "DestinoS3"
  log_group_name = aws_cloudwatch_log_group.visits_delivery.name
}

resource "aws_kinesis_firehose_delivery_stream" "visits" {
  name        = format("%s-visitas", var.project)
  destination = "extended_s3"

  # Cifrado en reposo mientras los registros esperan en el buffer, con una clave que administra AWS.
  server_side_encryption {
    enabled  = true
    key_type = "AWS_OWNED_CMK"
  }

  extended_s3_configuration {
    role_arn   = data.aws_iam_role.lab.arn
    bucket_arn = module.private_buckets["lake"].arn

    # Cada registro va a la carpeta de su día (particionado dinámico): la clave sale del propio
    # registro, no de la hora en que llegó. Una visita que termina 23:59 cae en su día aunque se
    # escriba 00:01, y la carga de demo puede escribir días pasados.
    prefix              = "${local.visits_table}/dt=!{partitionKeyFromQuery:dt}/"
    error_output_prefix = "errores/!{firehose:error-output-type}/!{timestamp:yyyy-MM-dd}/"

    # Firehose escribe un archivo cuando junta 64 MB o cuando pasa este tiempo. Más tiempo, menos
    # archivos y más grandes (lo que prefiere un motor columnar); menos, el dato aparece antes.
    buffering_size     = 64
    buffering_interval = var.lake_buffer_seconds

    dynamic_partitioning_configuration {
      enabled = true
    }

    processing_configuration {
      enabled = true

      processors {
        type = "MetadataExtraction"

        parameters {
          parameter_name  = "MetadataExtractionQuery"
          parameter_value = "{dt: .dt}"
        }

        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }
      }
    }

    # De JSON a Parquet con el esquema de la tabla de Glue. Los instantes llegan en milisegundos.
    data_format_conversion_configuration {
      input_format_configuration {
        deserializer {
          hive_json_ser_de {
            timestamp_formats = ["millis"]
          }
        }
      }

      output_format_configuration {
        serializer {
          parquet_ser_de {
            compression = "SNAPPY"
          }
        }
      }

      schema_configuration {
        database_name = aws_glue_catalog_table.visits.database_name
        table_name    = aws_glue_catalog_table.visits.name
        role_arn      = data.aws_iam_role.lab.arn
        region        = local.region
      }
    }

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.visits_delivery.name
      log_stream_name = aws_cloudwatch_log_stream.visits_delivery.name
    }
  }
}

# Athena: las consultas sobre el lake, del refresher y de cualquiera que use la consola.
resource "aws_athena_workgroup" "analytics" {
  name        = format("%s-analitica", var.project)
  description = "Consultas sobre el data lake de Queue."
  # Al destruir se borra aunque tenga consultas guardadas o en el historial.
  force_destroy = true

  configuration {
    # Lo que se fija acá vale para toda consulta del workgroup, aunque el cliente pida otra cosa.
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    # Una consulta que escanearía más que esto se cancela: un error no puede salir caro.
    bytes_scanned_cutoff_per_query = var.athena_scan_limit_mb * 1024 * 1024

    engine_version {
      selected_engine_version = "Athena engine version 3"
    }

    result_configuration {
      output_location = format("s3://%s/resultados/", module.private_buckets["athena"].name)

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
}

# El refresher cada N minutos. EventBridge invoca la función directamente: el permiso de abajo es lo
# único que necesita.
resource "aws_cloudwatch_event_rule" "analytics_refresh" {
  name                = format("%s-analytics-refresh", var.project)
  description         = "Recalcula los agregados del tablero de análisis."
  schedule_expression = var.analytics_refresh_minutes == 1 ? "rate(1 minute)" : format("rate(%d minutes)", var.analytics_refresh_minutes)
}

resource "aws_cloudwatch_event_target" "analytics_refresh" {
  rule = aws_cloudwatch_event_rule.analytics_refresh.name
  arn  = module.workers["analytics-refresher"].arn

  # Si una invocación falla, la próxima vuelta recalcula todo igual: no hace falta reintentar mucho.
  retry_policy {
    maximum_retry_attempts       = 2
    maximum_event_age_in_seconds = 300
  }
}

resource "aws_lambda_permission" "analytics_refresh" {
  statement_id  = "EventBridgeRecalculaAgregados"
  action        = "lambda:InvokeFunction"
  function_name = module.workers["analytics-refresher"].name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.analytics_refresh.arn
}
