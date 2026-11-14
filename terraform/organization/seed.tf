# Datos de demo, que la consigna permite: un local con dos colas y un usuario de staff, para que quien
# corrija pueda entrar y probar sin configurar nada. Se apagan con `demo_enabled = false`.

resource "random_password" "demo" {
  count = var.demo_enabled ? 1 : 0

  length  = 16
  special = false
}

resource "aws_cognito_user" "demo" {
  count = var.demo_enabled ? 1 : 0

  user_pool_id   = aws_cognito_user_pool.this.id
  username       = var.demo_email
  password       = random_password.demo[0].result
  message_action = "SUPPRESS"

  attributes = {
    email          = var.demo_email
    email_verified = "true"
    name           = local.demo_staff_name
  }
}

# La función usa las mismas operaciones del dominio que la API, así los datos tienen exactamente la
# forma que espera el resto del código. Es idempotente: si el local o una cola ya existen, los deja.
resource "aws_lambda_invocation" "seed" {
  count = var.demo_enabled ? 1 : 0

  function_name = module.workers["seed"].name

  # Se vuelve a invocar cuando cambian los datos (el input) o el código del seed. Su bundle trae el
  # dominio, así que cambia con casi cualquier cambio de las funciones: es inofensivo, porque el seed
  # es idempotente y solo crea lo que falta.
  triggers = {
    codigo = module.workers["seed"].source_code_hash
  }

  input = jsonencode(merge(local.demo, {
    owner = {
      sub         = aws_cognito_user.demo[0].sub
      email       = var.demo_email
      displayName = local.demo_staff_name
    }
  }))
}

# El historial de demo: meses de visitas inventadas en el data lake, para que el tablero de análisis
# tenga qué mostrar recién desplegado. Va aparte del seed de la operación porque no tiene que
# repetirse con cada cambio del código: se carga una vez por día de despliegue (hasta ayer), y como los
# ids de cada visita dependen de la cola y el día, recargar el mismo día no suma visitas nuevas.
resource "aws_lambda_invocation" "seed_history" {
  count = var.demo_enabled && var.demo_history_days > 0 ? 1 : 0

  function_name = module.workers["seed"].name

  triggers = {
    dia = formatdate("YYYY-MM-DD", plantimestamp())
  }

  input = jsonencode({
    history = {
      establishment = local.demo.establishment
      queues        = local.demo.queues
      days          = var.demo_history_days
    }
  })

  # El local tiene que existir antes que sus visitas (el tablero lo pide por id).
  depends_on = [aws_lambda_invocation.seed]
}
