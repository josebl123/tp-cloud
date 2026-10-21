# Lo que el módulo promete, en modo plan y sin AWS: `terraform test` en esta carpeta.

mock_provider "aws" {
  # El documento de política lo arma el provider; con el mock alcanza un JSON válido.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{}"
    }
  }
}

variables {
  name                       = "q-prueba"
  visibility_timeout_seconds = 180
  alarm_topic_arn            = "arn:aws:sns:us-east-1:123456789012:q-alerts"
}

run "estandar_con_su_dlq" {
  command = plan

  assert {
    condition     = aws_sqs_queue.this.name == "q-prueba" && aws_sqs_queue.dlq.name == "q-prueba-dlq"
    error_message = "Una cola estándar y su DLQ no llevan sufijo."
  }

  assert {
    condition     = aws_sqs_queue.this.fifo_queue == false && aws_sqs_queue.dlq.fifo_queue == false
    error_message = "La DLQ tiene que ser del mismo tipo que su cola."
  }

  assert {
    condition     = aws_sqs_queue.dlq.message_retention_seconds > aws_sqs_queue.this.message_retention_seconds
    error_message = "La DLQ tiene que guardar más tiempo que su cola."
  }

  assert {
    condition     = aws_sqs_queue.this.visibility_timeout_seconds == 180
    error_message = "La visibilidad es la que se pide."
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.dlq_not_empty.alarm_actions) == 1
    error_message = "Toda cola tiene su alarma de DLQ, con acción."
  }

  assert {
    condition     = length(aws_sqs_queue_policy.this) == 0 && length(aws_cloudwatch_metric_alarm.oldest_message) == 0
    error_message = "Sin tópicos ni umbral de antigüedad no hay política de publicación ni alarma de atraso."
  }
}

run "fifo_publicada_por_sns_y_con_alarma_de_atraso" {
  command = plan

  variables {
    fifo                    = true
    publisher_topic_arns    = ["arn:aws:sns:us-east-1:123456789012:q-queue-events.fifo"]
    max_message_age_seconds = 10
  }

  assert {
    condition     = aws_sqs_queue.this.name == "q-prueba.fifo" && aws_sqs_queue.dlq.name == "q-prueba-dlq.fifo"
    error_message = "Una FIFO y su DLQ terminan en .fifo, como exige SQS."
  }

  assert {
    condition     = aws_sqs_queue.this.fifo_queue && aws_sqs_queue.dlq.fifo_queue
    error_message = "La DLQ de una FIFO también es FIFO."
  }

  assert {
    condition     = length(aws_sqs_queue_policy.this) == 1
    error_message = "Con tópicos, la cola tiene la política que los deja publicar."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.oldest_message[0].threshold == 10
    error_message = "La alarma de atraso usa el umbral pedido."
  }
}

run "dlq_que_guarda_menos_que_su_cola" {
  command = plan

  variables {
    message_retention_seconds = 1209600
    dlq_retention_seconds     = 345600
  }

  expect_failures = [var.dlq_retention_seconds]
}

run "intentos_no_enteros" {
  command = plan

  variables {
    max_receive_count = 2.5
  }

  expect_failures = [var.max_receive_count]
}

run "umbral_de_atraso_negativo" {
  command = plan

  variables {
    max_message_age_seconds = -1
  }

  expect_failures = [var.max_message_age_seconds]
}
