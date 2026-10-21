# Una cola de trabajo con todo lo que la hace segura de operar: su DLQ, el tope de intentos, el
# permiso para que SNS le publique y una alarma apenas algo cae en la DLQ. Sin el módulo, cada cola
# serían seis recursos repetidos, y es fácil olvidarse la alarma en una.

locals {
  suffix = var.fifo ? ".fifo" : ""
}

# Las dos colas se cifran en reposo con la clave que administra SQS (SSE-SQS): sin KMS, sin costo y
# sin permisos extra para SNS ni para las funciones. Es lo que AWS ya aplica por defecto a una cola
# nueva; declararlo deja el cifrado escrito en el código.
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-dlq${local.suffix}"
  fifo_queue                = var.fifo
  message_retention_seconds = var.dlq_retention_seconds
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  name                       = "${var.name}${local.suffix}"
  fifo_queue                 = var.fifo
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = var.tags
}

# La DLQ solo acepta mensajes que vienen de su cola.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}

data "aws_iam_policy_document" "publishers" {
  count = length(var.publisher_topic_arns) > 0 ? 1 : 0

  statement {
    sid       = "PublicaSoloDesdeSusTopicos"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.this.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = var.publisher_topic_arns
    }
  }
}

resource "aws_sqs_queue_policy" "this" {
  count = length(var.publisher_topic_arns) > 0 ? 1 : 0

  queue_url = aws_sqs_queue.this.id
  policy    = data.aws_iam_policy_document.publishers[0].json
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name}-dlq-not-empty"
  alarm_description   = "Un mensaje de ${var.name} agotó sus ${var.max_receive_count} intentos y está en la DLQ."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "oldest_message" {
  count = var.max_message_age_seconds == null ? 0 : 1

  alarm_name          = "${var.name}-oldest-message"
  alarm_description   = "El mensaje más viejo de ${var.name} espera más de ${var.max_message_age_seconds} s: el consumidor no da abasto o está caído."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.this.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.max_message_age_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  tags                = var.tags
}
