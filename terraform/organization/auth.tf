# Las cuentas del staff, en Cognito. El navegador se registra e inicia sesión directo contra Cognito,
# desde las páginas propias del sitio (sin el Hosted UI, así no hace falta una URL de redirección
# HTTPS), y manda el token a la API, donde lo valida el authorizer de API Gateway.
#
# Tres decisiones de seguridad:
#   - El email se verifica con un código antes de poder entrar: nadie crea una cuenta con un mail ajeno.
#   - El inicio de sesión es SRP: el navegador demuestra que conoce la contraseña sin enviarla.
#   - Los tokens duran una hora y se renuevan solos con el refresh token, que dura un turno: un token
#     robado sirve poco tiempo, y el staff no tiene que volver a entrar en medio del turno.

resource "aws_cognito_user_pool" "this" {
  name = format("%s-staff", var.project)

  # Se inicia sesión con el email; el nombre de usuario interno es el `sub`.
  username_attributes = ["email"]

  # Ocho caracteres, con letras y números.
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = false
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    mutable             = true
    required            = true

    string_attribute_constraints {
      min_length = 1
      max_length = 120
    }
  }

  # Cognito manda un código al email al registrarse, y la cuenta no puede iniciar sesión hasta
  # confirmarlo. Usa su propio remitente (hasta 50 mails por día), que alcanza para el staff.
  auto_verified_attributes = ["email"]

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Tu código de Queue"
    email_message        = "Tu código para confirmar la cuenta de Queue es {####}."
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # La cátedra tiene que poder destruir todo.
  deletion_protection = "INACTIVE"
}

# El cliente que usa el navegador: sin secreto, porque cualquier secreto en una SPA es público.
resource "aws_cognito_user_pool_client" "web" {
  name         = format("%s-web", var.project)
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false
  # SRP para iniciar sesión (la contraseña no viaja) y refresh para renovar los tokens. Sin
  # USER_PASSWORD_AUTH: ningún cliente puede mandar la contraseña en el pedido.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Tokens de una hora; el refresh token dura un turno y los renueva sin volver a pedir la contraseña.
  id_token_validity      = 1
  access_token_validity  = 1
  refresh_token_validity = var.session_hours
  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "hours"
  }

  # Un email inexistente y una contraseña incorrecta responden lo mismo: no se puede averiguar quién
  # tiene cuenta.
  prevent_user_existence_errors = "ENABLED"
}
