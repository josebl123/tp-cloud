# El build estático del frontend, en el bucket privado del sitio. Lo sirve API Gateway (api.tf).

resource "aws_s3_object" "site" {
  for_each = local.site_objects

  bucket = module.private_buckets["spa"].name
  key    = each.key
  source = "${var.site_dir}/${each.value}"
  etag   = filemd5("${var.site_dir}/${each.value}")

  content_type = lookup(local.mime_types, lower(regex("[^.]+$", each.value)), "application/octet-stream")

  # Los archivos de _next/static llevan un hash en el nombre: si cambian, cambia el nombre, así que
  # el navegador los puede guardar un año. Todo lo demás se revalida en cada visita.
  cache_control = startswith(each.key, "_next/static/") ? "public, max-age=31536000, immutable" : "no-cache"
}

# Lo que el sitio necesita saber de esta infraestructura y recién se conoce después del apply: los
# ids de Cognito y la dirección del WebSocket. Se lee al cargar la página, así el build del frontend no depende del despliegue.
resource "aws_s3_object" "site_config" {
  bucket = module.private_buckets["spa"].name
  key    = "config.json"
  content = jsonencode({
    region           = local.region
    userPoolId       = aws_cognito_user_pool.this.id
    userPoolClientId = aws_cognito_user_pool_client.web.id
    websocketUrl     = aws_apigatewayv2_stage.ws.invoke_url
  })
  content_type  = "application/json"
  cache_control = "no-cache"
}
