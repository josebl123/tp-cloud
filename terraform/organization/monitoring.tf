# Las alarmas de todo el sistema avisan acá. Con `alert_email`, además llegan por email (hay que
# confirmar la suscripción desde el link que manda AWS).

# Sin cifrado, a propósito: las alarmas de CloudWatch no pueden publicar en un tópico cifrado con la
# clave que administra AWS; haría falta una clave KMS propia con su política. Solo lleva avisos de
# alarmas, sin datos de los clientes.
#tfsec:ignore:aws-sns-enable-topic-encryption
resource "aws_sns_topic" "alerts" {
  name = format("%s-alerts", var.project)
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count = var.alert_email == null ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
