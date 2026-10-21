# La API REST sirve dos cosas desde la misma URL, y por eso el frontend no necesita CORS:
#
#   /  y  /{proxy+}      el sitio, leído del bucket privado con LabRole
#   /api/v1/...          las funciones Lambda, con el authorizer de Cognito en las del staff
#
# CloudFront está bloqueado en el Learner Lab. API Gateway es la única puerta con HTTPS propio que
# puede servir el sitio sin dejar el bucket público. Las rutas están en openapi.tf.

resource "aws_api_gateway_rest_api" "this" {
  name        = format("%s-api", var.project)
  description = "Queue: sitio estático y API"
  body        = jsonencode(local.openapi)

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# API Gateway invoca las funciones de la API, y solo desde esta API.
resource "aws_lambda_permission" "api" {
  for_each = toset(distinct([for route in values(local.api_routes) : route.function]))

  statement_id  = "PermitirApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.api_functions[each.key].name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Un deployment es una foto de la API: si cambia el documento, hace falta otro.
  triggers = {
    redeployment = sha1(aws_api_gateway_rest_api.this.body)
  }

  # El stage apunta siempre a un deployment: el nuevo tiene que existir antes de borrar el viejo, o
  # la API queda sin servir durante el reemplazo.
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.api_stage_name
}

# Un techo a la medida de Lambda para la API, uno alto para los archivos del sitio y uno más bajo
# para las rutas que escribe cualquiera (openapi.tf explica los tres). Por encima, API Gateway
# responde 429 sin invocar ninguna Lambda: con la concurrencia de Lambda limitada en el lab, es la
# primera defensa contra una ráfaga.
resource "aws_api_gateway_method_settings" "this" {
  for_each = merge(
    { "*/*" = { rate = var.api_throttle_rate_limit, burst = var.api_throttle_burst_limit } },
    local.api_route_throttles,
  )

  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = each.key

  settings {
    throttling_rate_limit  = each.value.rate
    throttling_burst_limit = each.value.burst
  }
}
