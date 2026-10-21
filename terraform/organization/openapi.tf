# La definición completa de la API REST, como documento OpenAPI 3 con las extensiones de API Gateway.
#
# Con 35 rutas, declarar un recurso, un método, una integración y sus respuestas por cada una serían
# cientos de bloques casi iguales. En cambio, las rutas son una tabla (`api_routes`) y el documento se
# arma a partir de ella con expresiones `for`: sumar un endpoint es sumar una línea a la tabla y su
# handler en functions/src/handlers/.

locals {
  # ---------------------------------------------------------------------------------------------
  # Rutas de la API: "MÉTODO /ruta" → qué función la atiende y si exige sesión
  # ---------------------------------------------------------------------------------------------

  public_routes = [
    "GET /api/v1/health",
    "GET /api/v1/public/queues/{queueId}",
    "GET /api/v1/public/queues/{queueId}/availability",
    "GET /api/v1/public/queues/{queueId}/qr",
    "POST /api/v1/public/queues/{queueId}/entries",
    "GET /api/v1/public/tickets/{ticketToken}",
    "DELETE /api/v1/public/tickets/{ticketToken}",
    "GET /api/v1/public/tickets/{ticketToken}/notifications",
  ]

  staff_routes = [
    "GET /api/v1/auth/me",
    "GET /api/v1/establishments",
    "POST /api/v1/establishments",
    "GET /api/v1/establishments/{establishmentId}",
    "PATCH /api/v1/establishments/{establishmentId}",
    "GET /api/v1/establishments/{establishmentId}/members",
    "POST /api/v1/establishments/{establishmentId}/members",
    "GET /api/v1/establishments/{establishmentId}/queues",
    "POST /api/v1/establishments/{establishmentId}/queues",
    "GET /api/v1/establishments/{establishmentId}/metrics",
    "GET /api/v1/queues/{queueId}",
    "PATCH /api/v1/queues/{queueId}",
    "DELETE /api/v1/queues/{queueId}",
    "PUT /api/v1/queues/{queueId}/status",
    "GET /api/v1/queues/{queueId}/board",
    "POST /api/v1/queues/{queueId}/calls",
    "POST /api/v1/queues/{queueId}/ws-tickets",
    "GET /api/v1/queues/{queueId}/events",
    "GET /api/v1/queues/{queueId}/metrics",
    "GET /api/v1/queues/{queueId}/lanes",
    "POST /api/v1/queues/{queueId}/lanes",
    "PATCH /api/v1/queues/{queueId}/lanes/{laneId}",
    "DELETE /api/v1/queues/{queueId}/lanes/{laneId}",
    "GET /api/v1/entries/{entryId}",
    "PUT /api/v1/entries/{entryId}/status",
    "GET /api/v1/entries/{entryId}/events",
    "GET /api/v1/entries/{entryId}/notifications",
  ]

  api_routes = merge(
    { for route in local.public_routes : route => { function = "public", authorized = false } },
    { for route in local.staff_routes : route => { function = "staff", authorized = true } },
  )

  # Techos de throttling, en el formato `ruta/MÉTODO` que piden los method settings de un stage. Tres
  # niveles:
  #
  #   */*               la API (y el index.html de la raíz): a la medida de la concurrencia de Lambda
  #                     del lab. Por encima, API Gateway responde 429 en vez de que Lambda falle con un
  #                     5xx.
  #   {proxy+}/GET      los archivos del sitio: no invocan ninguna Lambda, así que su techo es alto.
  #                     Veinte personas escaneando el mismo QR piden cientos de archivos a la vez, y con
  #                     el techo de la API la página cargaba rota.
  #   unirse y salir    más bajo todavía: las escribe cualquiera, sin sesión.
  #
  # Son pocas entradas a propósito: cada una es una modificación del mismo stage, y muchas aplicadas
  # en paralelo pueden chocar entre sí.
  api_route_throttles = merge(
    { "{proxy+}/GET" = { rate = var.site_throttle_rate_limit, burst = var.site_throttle_burst_limit } },
    {
      for route in ["POST /api/v1/public/queues/{queueId}/entries", "DELETE /api/v1/public/tickets/{ticketToken}"] :
      format("%s/%s", trimprefix(split(" ", route)[1], "/"), split(" ", route)[0]) => {
        rate  = var.public_write_rate_limit
        burst = var.public_write_burst_limit
      }
    },
  )

  api_operations = {
    for route, target in local.api_routes : route => merge(target, {
      method = lower(split(" ", route)[0])
      path   = split(" ", route)[1]
    })
  }

  # Cada ruta, con sus parámetros de path, el authorizer si corresponde y la integración con su
  # Lambda. API Gateway entrega el pedido entero (aws_proxy) y la función responde status, headers y
  # cuerpo.
  api_paths = {
    for path in distinct([for operation in values(local.api_operations) : operation.path]) : path => {
      for operation in values(local.api_operations) : operation.method => merge(
        {
          responses = { "200" = { description = "OK" } }
          "x-amazon-apigateway-integration" = {
            type                = "aws_proxy"
            httpMethod          = "POST"
            uri                 = module.api_functions[operation.function].invoke_arn
            passthroughBehavior = "when_no_match"
          }
        },
        length(regexall("\\{", path)) == 0 ? {} : {
          parameters = [
            for name in regexall("\\{([A-Za-z]+)\\}", path) : { name = name[0], in = "path", required = true, schema = { type = "string" } }
          ]
        },
        operation.authorized ? { security = [{ cognito = [] }] } : {},
      ) if operation.path == path
    }
  }

  # ---------------------------------------------------------------------------------------------
  # El sitio: la raíz y todo lo que no es /api, leído del bucket privado con LabRole
  # ---------------------------------------------------------------------------------------------

  site_header_names = ["Content-Type", "Cache-Control"]

  # El tipo de contenido y la política de caché los decide cada objeto de S3 (site.tf).
  site_response = {
    responseParameters = {
      for header in local.site_header_names : "method.response.header.${header}" => "integration.response.header.${header}"
    }
  }

  site_method_responses = {
    for status in ["200", "404"] : status => {
      description = status == "200" ? "Archivo del sitio" : "No existe"
      headers     = { for header in local.site_header_names : header => { schema = { type = "string" } } }
    }
  }

  # La página 404 del build, entera dentro de la plantilla. API Gateway la procesa con Velocity, y el
  # HTML de Next trae `$` y `#`: el bloque `#[[ ... ]]#` hace que se copie tal cual. Sin el build (un
  # destroy, por ejemplo) queda una página mínima.
  not_found_page     = fileexists("${var.site_dir}/404.html") ? file("${var.site_dir}/404.html") : "<!doctype html><title>404</title><h1>404</h1>"
  not_found_template = format("#[[%s]]#", local.not_found_page)

  site_integration = {
    type                = "aws"
    httpMethod          = "GET"
    credentials         = data.aws_iam_role.lab.arn
    passthroughBehavior = "when_no_match"
    responses = {
      # Cualquier 4xx de S3 (la clave no existe) es un 404 con la página del sitio en vez del XML de
      # S3. Con `binary_media_types` en `*/*` la respuesta llega como binaria, y a una binaria no se le
      # aplica plantilla: CONVERT_TO_TEXT la pasa a texto para que la plantilla la reemplace. La
      # plantilla se elige por el Accept del pedido: un navegador pide text/html, y sin Accept vale
      # application/json.
      "4\\d{2}" = {
        statusCode      = "404"
        contentHandling = "CONVERT_TO_TEXT"
        responseParameters = {
          "method.response.header.Content-Type"  = "'text/html; charset=utf-8'"
          "method.response.header.Cache-Control" = "'no-store'"
        }
        responseTemplates = { for type in ["text/html", "application/json"] : type => local.not_found_template }
      }
      default = merge(local.site_response, { statusCode = "200" })
    }
  }

  site_bucket_path = format("arn:%s:apigateway:%s:s3:path/%s", data.aws_partition.current.partition, local.region, module.private_buckets["spa"].name)

  site_paths = {
    "/" = {
      get = {
        responses                         = local.site_method_responses
        "x-amazon-apigateway-integration" = merge(local.site_integration, { uri = "${local.site_bucket_path}/index.html" })
      }
    }
    "/{proxy+}" = {
      get = {
        parameters = [{ name = "proxy", in = "path", required = true, schema = { type = "string" } }]
        responses  = local.site_method_responses
        "x-amazon-apigateway-integration" = merge(local.site_integration, {
          uri               = "${local.site_bucket_path}/{key}"
          requestParameters = { "integration.request.path.key" = "method.request.path.proxy" }
        })
      }
    }
  }

  # ---------------------------------------------------------------------------------------------
  # Errores que responde API Gateway sin invocar ninguna función, con la misma forma RFC 7807 que
  # los de las funciones: el frontend los lee igual.
  # ---------------------------------------------------------------------------------------------

  gateway_problems = {
    UNAUTHORIZED                 = { status = 401, title = "Unauthorized", code = "UNAUTHENTICATED", detail = "Authentication is required" }
    ACCESS_DENIED                = { status = 403, title = "Forbidden", code = "FORBIDDEN", detail = "You cannot access this resource" }
    MISSING_AUTHENTICATION_TOKEN = { status = 404, title = "Not Found", code = "NOT_FOUND", detail = "There is nothing at this address" }
    THROTTLED                    = { status = 429, title = "Too Many Requests", code = "TOO_MANY_REQUESTS", detail = "Too many requests. Please try again in a moment." }
  }

  gateway_responses = {
    for type, problem in local.gateway_problems : type => {
      statusCode         = tostring(problem.status)
      responseParameters = { "gatewayresponse.header.Content-Type" = "'application/problem+json'" }
      responseTemplates = {
        "application/json" = jsonencode({
          type     = format("https://q.itba.ar/problems/%s", lower(replace(problem.code, "_", "-")))
          title    = problem.title
          status   = problem.status
          detail   = problem.detail
          code     = problem.code
          instance = "$context.path"
        })
      }
    }
  }

  # ---------------------------------------------------------------------------------------------
  # El documento
  # ---------------------------------------------------------------------------------------------

  openapi = {
    openapi = "3.0.1"
    info = {
      title   = format("%s-api", var.project)
      version = "1.0"
    }
    paths = merge(local.site_paths, local.api_paths)
    components = {
      securitySchemes = {
        # El token de Cognito lo valida API Gateway: una función solo se invoca con un token válido.
        cognito = {
          type                           = "apiKey"
          name                           = "Authorization"
          in                             = "header"
          "x-amazon-apigateway-authtype" = "cognito_user_pools"
          "x-amazon-apigateway-authorizer" = {
            type         = "cognito_user_pools"
            providerARNs = [aws_cognito_user_pool.this.arn]
          }
        }
      }
    }
    # Fuentes, imágenes y el QR pasan sin convertirse a texto. Como consecuencia, API Gateway también
    # entrega en base64 los JSON que llegan a las funciones, y las funciones los decodifican.
    "x-amazon-apigateway-binary-media-types" = ["*/*"]
    "x-amazon-apigateway-gateway-responses"  = local.gateway_responses
  }
}
