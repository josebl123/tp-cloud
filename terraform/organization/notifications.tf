# SES para los avisos a clientes. **El Learner Lab lo niega entero**: ni el rol del pipeline ni LabRole
# pueden crear o verificar una identidad, ni mandar. En el lab, ses_sender_email queda en null y los
# avisos salen por el SMTP de Gmail (el secreto de abajo), o se simulan si no hay remitente. En una cuenta con SES (que empieza en el sandbox: solo manda desde y hacia
# direcciones verificadas), crear una identidad le manda a esa dirección un email de AWS con un link
# que hay que abrir.
#
# Sin remitente, o hacia alguien no verificado, el notifier escribe el email en sus logs en lugar de
# mandarlo: un envío simulado, que la consigna permite.

resource "aws_sesv2_email_identity" "sender" {
  count = var.ses_sender_email == null ? 0 : 1

  email_identity = var.ses_sender_email
}

# Las direcciones del grupo, para recibir los avisos de verdad mientras se prueba.
resource "aws_sesv2_email_identity" "recipients" {
  for_each = toset([for email in var.ses_verified_recipients : lower(email) if lower(email) != lower(var.ses_sender_email == null ? "" : var.ses_sender_email)])

  email_identity = each.value
}

# La alternativa a SES en el lab: el SMTP de Gmail (functions/src/notifications/smtp.ts). Terraform
# crea el secreto vacío; el valor, la contraseña de aplicación de la cuenta, lo escribe el pipeline
# con la CLI después del apply, así nunca queda en el plan (que es un artefacto descargable del
# workflow) ni en el estado. Mientras no tenga valor, el notifier simula los envíos.
resource "aws_secretsmanager_secret" "smtp" {
  count = var.smtp_sender_email == null ? 0 : 1

  name        = format("%s-smtp", var.project)
  description = "Contraseña de aplicación de Gmail del remitente de los avisos."

  # Sin ventana de recuperación: con la de 30 días por defecto, después de un destroy el nombre queda
  # reservado y el apply siguiente falla al crearlo.
  recovery_window_in_days = 0
}

