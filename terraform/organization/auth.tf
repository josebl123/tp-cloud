# Las cuentas del staff, en Cognito. El navegador se registra e inicia sesión directo contra Cognito,
# desde las páginas propias del sitio (sin el Hosted UI, así no hace falta una URL de redirección
# HTTPS), y manda el token a la API, donde lo valida el authorizer de API Gateway.

resource "aws_cognito_user_pool" "this" {
  name = format("%s-staff", var.project)

  # Se inicia sesión con el email; el nombre de usuario interno es el `sub`.
  username_attributes = ["email"]

  # Ocho caracteres y nada más, igual que pedía la versión Java: el frontend ya lo explica así.
  password_policy {
    minimum_length                   = 8
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
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

  # Confirma la cuenta en el momento del registro (functions/src/handlers/cognito-pre-signup.ts).
  lambda_config {
    pre_sign_up = module.pre_signup.arn
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
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Un turno entero sin volver a iniciar sesión, como el token de la versión Java.
  id_token_validity      = var.session_hours
  access_token_validity  = var.session_hours
  refresh_token_validity = 30
  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }

  # Un email inexistente y una contraseña incorrecta responden lo mismo: no se puede averiguar quién
  # tiene cuenta.
  prevent_user_existence_errors = "ENABLED"
}

# La función del trigger va aparte del mapa de functions.tf: el user pool la referencia, y la función
# del staff referencia al user pool. En el mismo for_each, eso sería un ciclo.
module "pre_signup" {
  source = "../modules/lambda-function"

  name               = format("%s-cognito-pre-signup", var.project)
  description        = "Confirma en el acto las cuentas que se registran."
  source_file        = "${var.functions_dist_dir}/cognito-pre-signup/index.mjs"
  memory_size        = 128
  timeout            = 5
  role_arn           = data.aws_iam_role.lab.arn
  artifacts_bucket   = module.private_buckets["artifacts"].name
  log_retention_days = var.log_retention_days
}

resource "aws_lambda_permission" "pre_signup" {
  statement_id  = "PermitirCognito"
  action        = "lambda:InvokeFunction"
  function_name = module.pre_signup.name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}
