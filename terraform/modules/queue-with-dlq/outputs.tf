output "arn" {
  description = "ARN de la cola, para suscribirla a SNS o conectarle una Lambda."
  value       = aws_sqs_queue.this.arn
}

output "url" {
  description = "URL de la cola, la que usa el SDK para enviar mensajes."
  value       = aws_sqs_queue.this.id
}

output "name" {
  description = "Nombre de la cola."
  value       = aws_sqs_queue.this.name
}

output "dlq_arn" {
  description = "ARN de la DLQ."
  value       = aws_sqs_queue.dlq.arn
}

output "dlq_url" {
  description = "URL de la DLQ, para inspeccionar o redirigir sus mensajes."
  value       = aws_sqs_queue.dlq.id
}
