output "site_url" {
  description = "Dirección del sitio. Es la que se abre en el navegador."
  value       = "${aws_api_gateway_stage.this.invoke_url}/"
}

output "health_url" {
  description = "Prueba de humo: responde 200 si la API puede escribir y leer la tabla principal."
  value       = "${aws_api_gateway_stage.this.invoke_url}/api/v1/health"
}

output "demo_queue_url" {
  description = "La cola de demo, como la abre un cliente al escanear el QR."
  value       = var.demo_enabled ? format("%s/q/?id=%s", aws_api_gateway_stage.this.invoke_url, local.demo.queues[0].id) : null
}

output "demo_staff_email" {
  description = "Usuario de staff de demo, para entrar al panel."
  value       = var.demo_enabled ? var.demo_email : null
}

output "demo_staff_password" {
  description = "Contraseña del usuario de demo. Se ve con `terraform output -raw demo_staff_password`."
  value       = try(random_password.demo[0].result, null)
  sensitive   = true
}

output "websocket_url" {
  description = "API WebSocket del tiempo real."
  value       = aws_apigatewayv2_stage.ws.invoke_url
}

output "user_pool_id" {
  description = "User pool de Cognito del staff."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_client_id" {
  description = "Cliente de Cognito que usa el sitio."
  value       = aws_cognito_user_pool_client.web.id
}

output "bucket_names" {
  description = "Los tres buckets privados, por función."
  # Directo de los locals, no de los módulos, para que se conozca en el plan: el pipeline lo lee del
  # plan guardado para crear los buckets antes del apply.
  value = local.bucket_names
}

output "main_table_name" {
  description = "Tabla principal de DynamoDB."
  value       = module.main_table.dynamodb_table_id
}

output "connections_table_name" {
  description = "Tabla de conexiones WebSocket, con el índice byQueue."
  value       = module.connections_table.dynamodb_table_id
}

output "function_names" {
  description = "Funciones Lambda desplegadas."
  value = merge(
    { for key, function in module.api_functions : key => function.name },
    { for key, function in module.workers : key => function.name },
    { pre_signup = module.pre_signup.name },
  )
}

output "smtp_secret_id" {
  description = "Secreto de la contraseña SMTP, al que el pipeline le escribe el valor. null sin smtp_sender_email."
  value       = try(aws_secretsmanager_secret.smtp[0].arn, null)
}

output "smtp_sender_email" {
  description = "Remitente de los avisos por SMTP. La prueba de humo se une a la cola de demo con esta dirección."
  value       = var.smtp_sender_email
}

output "stream_mapping_uuid" {
  description = "El mapping del stream de q-main. La prueba de humo espera a que procese su primer lote."
  value       = aws_lambda_event_source_mapping.stream.uuid
}

