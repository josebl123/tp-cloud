# La API WebSocket del tiempo real. AWS sostiene las conexiones; las funciones solo se invocan al
# abrir y al cerrar cada una:
#
#   $connect      λ ws-connections: valida el ticket del cliente o el de un solo uso del staff
#   $disconnect   λ ws-connections: borra la conexión
#   ping          sin Lambda (integración mock): el navegador lo manda cada pocos minutos para que
#                 API Gateway no corte la conexión por inactividad a los 10
#
# El navegador nunca le manda datos: los recibe del broadcaster, que escribe por la API de
# administración de conexiones.

resource "aws_apigatewayv2_api" "ws" {
  name                       = format("%s-realtime", var.project)
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "connections" {
  api_id             = aws_apigatewayv2_api.ws.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = module.workers["ws-connections"].invoke_arn
}

resource "aws_apigatewayv2_route" "connections" {
  for_each = toset(["$connect", "$disconnect"])

  api_id    = aws_apigatewayv2_api.ws.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.connections.id}"
}

resource "aws_apigatewayv2_integration" "ping" {
  api_id                        = aws_apigatewayv2_api.ws.id
  integration_type              = "MOCK"
  template_selection_expression = "\\$default"
  request_templates = {
    "$default" = jsonencode({ statusCode = 200 })
  }
}

resource "aws_apigatewayv2_route" "ping" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "ping"
  target    = "integrations/${aws_apigatewayv2_integration.ping.id}"
}

resource "aws_lambda_permission" "ws_connections" {
  statement_id  = "PermitirWebSocket"
  action        = "lambda:InvokeFunction"
  function_name = module.workers["ws-connections"].name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*"
}

resource "aws_apigatewayv2_deployment" "ws" {
  api_id = aws_apigatewayv2_api.ws.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_apigatewayv2_integration.connections,
      aws_apigatewayv2_integration.ping,
      aws_apigatewayv2_route.connections,
      aws_apigatewayv2_route.ping,
    ]))
  }

  # Un deployment de una API WebSocket falla si la API todavía no tiene rutas. No hace falta
  # depends_on: el hash de arriba referencia las rutas, y esa referencia ya ordena la creación.

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_stage" "ws" {
  api_id        = aws_apigatewayv2_api.ws.id
  name          = var.api_stage_name
  deployment_id = aws_apigatewayv2_deployment.ws.id

  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate_limit
    throttling_burst_limit = var.api_throttle_burst_limit
  }
}
