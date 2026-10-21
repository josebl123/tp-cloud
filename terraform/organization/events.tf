# El bus de eventos:
#
#   q-main ──Streams──▶ λ stream-publisher ──▶ SNS FIFO q-queue-events ──┬─▶ SQS FIFO q-push
#                              │                                         └─▶ SQS q-notifications (filtrada)
#                              └──────────────────────────────────────────▶ SQS q-lifecycle (con demora)
#
# Cada evento es un ítem escrito en la misma transacción que el cambio que describe: existe si y
# solo si el cambio se confirmó. Lo que pasa después es asíncrono, reintentable e idempotente.

# Sin cifrado propio, a propósito: un evento pasa por el tópico solo hasta entregarse a las colas SQS,
# que sí lo cifran en reposo. Cifrar el tópico sumaría KMS a la publicación de cada evento.
#tfsec:ignore:aws-sns-enable-topic-encryption
resource "aws_sns_topic" "queue_events" {
  name       = format("%s-queue-events.fifo", var.project)
  fifo_topic = true
  # La deduplicación la da el id de cada evento: un registro del stream reprocesado no se publica dos
  # veces en una ventana de 5 minutos.
  content_based_deduplication = false
}

module "queues" {
  source   = "../modules/queue-with-dlq"
  for_each = local.queues

  name                       = format("%s-%s", var.project, each.key)
  fifo                       = each.value.fifo
  visibility_timeout_seconds = 6 * each.value.consumer_timeout
  publisher_topic_arns       = each.value.from_topic ? [aws_sns_topic.queue_events.arn] : []
  max_message_age_seconds    = each.value.max_message_age_seconds
  alarm_topic_arn            = aws_sns_topic.alerts.arn
}

resource "aws_sns_topic_subscription" "queues" {
  for_each = { for key, queue in local.queues : key => queue if queue.from_topic }

  topic_arn = aws_sns_topic.queue_events.arn
  protocol  = "sqs"
  endpoint  = module.queues[each.key].arn

  # El cuerpo llega tal cual lo publicó stream-publisher, sin el sobre de SNS.
  raw_message_delivery = true

  filter_policy       = each.value.event_types == null ? null : jsonencode({ type = each.value.event_types })
  filter_policy_scope = each.value.event_types == null ? null : "MessageAttributes"
}

# Adonde va un lote del stream que agotó sus reintentos. El stream solo retiene 24 horas: sin esto,
# un evento que no se puede publicar se perdería sin que nadie se entere.
resource "aws_sqs_queue" "stream_failures" {
  name                      = format("%s-stream-failures", var.project)
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_cloudwatch_metric_alarm" "stream_failures" {
  alarm_name          = format("%s-stream-failures", var.project)
  alarm_description   = "Un lote del stream de q-main no se pudo publicar después de todos sus reintentos."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.stream_failures.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_lambda_event_source_mapping" "stream" {
  event_source_arn = module.main_table.dynamodb_table_stream_arn
  function_name    = module.workers["stream-publisher"].arn

  # Desde el registro más viejo que retiene el stream, no desde el último. El mapping tarda unos
  # minutos en empezar a leer después de crearse: con LATEST, lo que se escribe en ese rato se pierde,
  # y en un despliegue desde cero eso es la carga de demo y la prueba de humo entera. Releer al crear
  # el mapping es inofensivo: los consumidores deciden con el estado actual. Lo que pase de una hora
  # (maximum_record_age_in_seconds) va a q-stream-failures.
  starting_position                  = "TRIM_HORIZON"
  batch_size                         = 100
  maximum_batching_window_in_seconds = 0
  # Una ejecución por shard: el orden de los eventos de una cola se conserva, y con la concurrencia
  # de Lambda limitada en el lab, el stream nunca ocupa más de una.
  parallelization_factor = 1

  # Si un registro falla, la función informa cuál y Lambda reintenta desde ahí, no el lote entero.
  function_response_types = ["ReportBatchItemFailures"]
  # Si aun así falla, partir el lote en dos aísla el registro problemático del resto.
  bisect_batch_on_function_error = true
  # Con tope: sin él, un registro que siempre falla bloquearía el shard hasta que venza (24 h).
  maximum_retry_attempts        = 5
  maximum_record_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.stream_failures.arn
    }
  }

  # Solo los ítems de evento nuevos. Todo lo demás que cambia en q-main (entradas, colas, avisos,
  # límites por IP) se descarta antes de invocar la función: no gasta concurrencia ni se paga.
  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb  = { NewImage = { kind = { S = ["EVENT"] } } }
      })
    }
  }
}
