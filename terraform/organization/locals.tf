locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region

  # Los nombres de bucket son globales en S3: la cuenta y la región los hacen únicos en cualquier
  # cuenta del Learner Lab, incluida la de la cátedra.
  name_suffix = "${local.account_id}-${local.region}"

  # Lo que se pide a cualquier email de las variables: algo, una arroba, un dominio con un punto.
  email_pattern = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"

  # Solo variables: estos tags los usa el bloque provider, que no puede depender de datasources.
  tags = {
    Proyecto      = "queue"
    Grupo         = "g9"
    Materia       = "82.08"
    Prefijo       = var.project
    GestionadoPor = "terraform"
  }

  # ---------------------------------------------------------------------------------------------
  # Buckets
  # ---------------------------------------------------------------------------------------------

  # Los buckets que registran su acceso en el de logs. El de logs no se registra a sí mismo: cada
  # registro escrito generaría otro registro.
  logged_buckets = {
    spa = {
      # El sitio se reconstruye desde git en cada despliegue: versionarlo no agrega nada.
      versioning_enabled = false
    }
    artifacts = {
      # Las funciones apuntan a una versión exacta del zip, así que el versionado es obligatorio.
      versioning_enabled = true
    }
  }

  logged_bucket_names = {
    for key in keys(local.logged_buckets) : key => format("%s-%s-%s", var.project, key, local.name_suffix)
  }

  bucket_names = merge(local.logged_bucket_names, {
    logs = format("%s-logs-%s", var.project, local.name_suffix)
  })

  # ---------------------------------------------------------------------------------------------
  # Funciones
  # ---------------------------------------------------------------------------------------------

  # Dos grupos de funciones, cada uno con su for_each en functions.tf. La separación evita un ciclo:
  # la API REST depende de las funciones que atiende, y algunos workers necesitan la URL de la API
  # (para los links de los avisos y las vistas). En un solo mapa, todo dependería de todo.
  #
  # Sumar una función es sumar una entrada al grupo que corresponde y su handler en
  # functions/src/handlers/.

  # Las que atiende API Gateway REST (openapi.tf).
  api_functions = {
    # Los clientes, sin sesión: ver la cola, unirse, su ticket, el QR y la prueba de salud.
    public = {
      description = "API pública: clientes anónimos, autorizados por su ticket."
      # El QR se genera en memoria: con más memoria, Lambda también da más CPU.
      memory_size = 512
      timeout     = 10
      environment = {
        TABLE_NAME       = module.main_table.dynamodb_table_id
        JOINS_PER_MINUTE = tostring(var.joins_per_minute)
      }
    }
    # El panel. Recibe el usuario ya validado por el authorizer de Cognito.
    staff = {
      description = "API del staff: detrás del authorizer de Cognito."
      memory_size = 512
      timeout     = 15
      environment = {
        TABLE_NAME   = module.main_table.dynamodb_table_id
        USER_POOL_ID = aws_cognito_user_pool.this.id
      }
    }
  }

  # Los consumidores de cada cola de trabajo. Solo valores fijos: el timeout de cada uno define
  # también la visibilidad de su cola (seis veces el timeout, como recomienda AWS), y si este mapa
  # dependiera de las colas habría otro ciclo.
  consumers = {
    broadcaster = { queue = "push", timeout = 30, batch_size = 10 }
    notifier    = { queue = "notifications", timeout = 30, batch_size = 10 }
    lifecycle   = { queue = "lifecycle", timeout = 60, batch_size = 5 }
  }

  # Las que reaccionan a eventos: el stream, el WebSocket, las colas y la carga de demo.
  workers = {
    # Lee el stream de q-main y publica cada evento en el bus (events.tf).
    stream-publisher = {
      description = "Publica los eventos de dominio de q-main en SNS y programa la gracia en SQS."
      memory_size = 256
      timeout     = 30
      environment = {
        TOPIC_ARN           = aws_sns_topic.queue_events.arn
        LIFECYCLE_QUEUE_URL = module.queues["lifecycle"].url
      }
    }
    # $connect y $disconnect de la API WebSocket (realtime.tf).
    ws-connections = {
      description = "Abre y cierra las conexiones WebSocket, con el ticket del cliente o el de un solo uso del staff."
      memory_size = 256
      timeout     = 5
      environment = {
        TABLE_NAME        = module.main_table.dynamodb_table_id
        CONNECTIONS_TABLE = module.connections_table.dynamodb_table_id
      }
    }
    # Consume q-push y empuja las vistas por el WebSocket.
    broadcaster = {
      description = "Empuja a cada navegador la vista actual de la cola que mira."
      memory_size = 512
      timeout     = local.consumers.broadcaster.timeout
      environment = {
        TABLE_NAME        = module.main_table.dynamodb_table_id
        CONNECTIONS_TABLE = module.connections_table.dynamodb_table_id
        WS_ENDPOINT       = local.websocket_management_url
        SITE_URL          = local.site_url
      }
    }
    # Consume q-notifications y manda los avisos por el SMTP de Gmail o por SES.
    notifier = {
      description = "Decide qué avisos corresponden y los manda por email, una sola vez cada uno."
      memory_size = 256
      timeout     = local.consumers.notifier.timeout
      environment = {
        TABLE_NAME     = module.main_table.dynamodb_table_id
        SENDER_EMAIL   = var.ses_sender_email == null ? "" : var.ses_sender_email
        SMTP_SENDER    = var.smtp_sender_email == null ? "" : var.smtp_sender_email
        SMTP_SECRET_ID = try(aws_secretsmanager_secret.smtp[0].arn, "")
        SITE_URL       = local.site_url
      }
    }
    # Consume q-lifecycle: gracias vencidas y cierres de cola.
    lifecycle = {
      description = "Aplica la gracia vencida y libera las colas cerradas en lotes."
      memory_size = 256
      timeout     = local.consumers.lifecycle.timeout
      environment = {
        TABLE_NAME          = module.main_table.dynamodb_table_id
        LIFECYCLE_QUEUE_URL = module.queues["lifecycle"].url
      }
    }
    # Carga los datos de demo. La invoca Terraform (seed.tf), no API Gateway.
    seed = {
      description = "Datos de demo: un local con dos colas y sus carriles."
      memory_size = 256
      timeout     = 30
      environment = {
        TABLE_NAME = module.main_table.dynamodb_table_id
      }
    }
  }

  # Las URLs se arman con los ids de las APIs y no con sus stages: el stage depende del deployment,
  # el deployment de las integraciones y las integraciones de las funciones. Con el id no hay ciclo.
  site_url                 = format("https://%s.execute-api.%s.amazonaws.com/%s", aws_api_gateway_rest_api.this.id, local.region, var.api_stage_name)
  websocket_management_url = format("https://%s.execute-api.%s.amazonaws.com/%s", aws_apigatewayv2_api.ws.id, local.region, var.api_stage_name)

  # ---------------------------------------------------------------------------------------------
  # Bus de eventos
  # ---------------------------------------------------------------------------------------------

  # Las colas de trabajo, una por consumidor. `consumer_timeout` es el timeout de la Lambda
  # que la consume: la visibilidad de la cola es seis veces eso, como recomienda AWS, para que un
  # mensaje no reaparezca mientras todavía se está procesando.
  queues = {
    # El push en vivo. FIFO: los eventos de una misma cola llegan en orden, de a un lote por cola.
    push = {
      fifo             = true
      consumer_timeout = local.consumers.broadcaster.timeout
      from_topic       = true
      event_types      = null
      # El push en vivo tiene que ser casi inmediato: más de 10 s de atraso es un consumidor caído.
      max_message_age_seconds = 10
    }
    # Los avisos a clientes. Solo los eventos que pueden mover a alguien de lugar o cambiar su espera.
    notifications = {
      fifo                    = false
      consumer_timeout        = local.consumers.notifier.timeout
      from_topic              = true
      event_types             = local.notification_event_types
      max_message_age_seconds = null
    }
    # Lo que dispara el sistema y no una persona: la gracia vencida (con demora) y el cierre de colas.
    # Le escribe stream-publisher directamente, porque SNS no permite una demora por mensaje.
    lifecycle = {
      fifo                    = false
      consumer_timeout        = local.consumers.lifecycle.timeout
      from_topic              = false
      event_types             = null
      max_message_age_seconds = null
    }
  }

  notification_event_types = [
    "ENTRY_JOINED",
    "ENTRY_CALLED",
    "ENTRY_SERVING_STARTED",
    "ENTRY_SERVED",
    "ENTRY_LEFT",
    "ENTRY_NO_SHOW",
    "ENTRY_REQUEUED",
    "QUEUE_UPDATED",
    "LANE_CHANGED",
  ]

  # ---------------------------------------------------------------------------------------------
  # Datos de demo
  # ---------------------------------------------------------------------------------------------

  demo            = jsondecode(file("${path.module}/seed/demo.json"))
  demo_staff_name = "Staff de demo"

  # ---------------------------------------------------------------------------------------------
  # Sitio estático
  # ---------------------------------------------------------------------------------------------

  mime_types = {
    html  = "text/html; charset=utf-8"
    txt   = "text/plain; charset=utf-8"
    js    = "text/javascript; charset=utf-8"
    css   = "text/css; charset=utf-8"
    json  = "application/json"
    svg   = "image/svg+xml"
    png   = "image/png"
    ico   = "image/x-icon"
    woff2 = "font/woff2"
  }

  # Si el frontend no está compilado (por ejemplo en `terraform validate`), fileset devuelve un
  # conjunto vacío y no se sube nada.
  site_files = fileset(var.site_dir, "**")

  # Next exporta cada página como <ruta>/index.html, pero la integración de API Gateway con S3 pide
  # la clave tal cual llega en la URL y no agrega index.html. Cada página se sube además con su ruta
  # como clave, con y sin la barra final, así /prod/login/ y /prod/login encuentran el HTML.
  page_files = [for file in local.site_files : file if endswith(file, "/index.html")]

  site_objects = merge(
    { for file in local.site_files : file => file },
    { for file in local.page_files : trimsuffix(file, "index.html") => file },
    { for file in local.page_files : trimsuffix(file, "/index.html") => file },
  )
}
