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

  # Crear un usuario dispara el trigger de pre sign-up, y Cognito solo puede invocarlo cuando el
  # permiso ya existe. Nada en este recurso referencia al permiso: Terraform no lo vería.
  depends_on = [aws_lambda_permission.pre_signup]
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
