# La analítica: un ETL en streaming de la operación (OLTP) a una tabla de hechos en un data lake.
#
#   SNS q-queue-events ─▶ SQS q-analytics ─▶ λ archiver ─▶ Firehose q-visitas ─▶ S3 lake (Parquet, por día)
#                                                                  │
#                                       Glue Data Catalog ◀────────┘ (el esquema con que convierte)
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
#     cualquier motor que entienda el catálogo puede consultarlos sin moverlos.
#
# El esquema se define una vez acá (schema-on-read): los archivos son Parquet común en S3, y el motor
# que los consulte lee la estructura del catálogo.

locals {
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
