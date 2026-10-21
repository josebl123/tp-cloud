variable "region" {
  description = "Región de AWS donde se despliega todo. El Learner Lab habilita us-east-1 y us-west-2."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = contains(["us-east-1", "us-west-2"], var.region)
    error_message = "El Learner Lab solo habilita us-east-1 y us-west-2."
  }
}

variable "project" {
  description = "Prefijo de todos los nombres en AWS. Corto, porque los nombres de bucket tienen un máximo de 63 caracteres."
  type        = string
  default     = "q"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,9}$", var.project))
    error_message = "El prefijo va en minúsculas, empieza con una letra y tiene hasta 10 caracteres."
  }
}

variable "lab_role_name" {
  description = "Rol que provee el Learner Lab. Es el único disponible, porque el lab no permite crear roles."
  type        = string
  default     = "LabRole"
}

variable "api_stage_name" {
  description = "Stage de la API REST. Forma parte de la URL, así que el frontend se compila con el mismo valor como ruta base."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z0-9]+$", var.api_stage_name))
    error_message = "El stage va en minúsculas y sin símbolos, porque aparece en la URL."
  }
}

variable "site_dir" {
  description = "Carpeta con el build estático del frontend (`npm run build` deja el resultado en `out/`)."
  type        = string
  default     = "../../frontend/out"
}

variable "functions_dist_dir" {
  description = "Carpeta con los bundles de las funciones (`npm run build` en `functions/`)."
  type        = string
  default     = "../../functions/dist"
}

variable "log_retention_days" {
  description = "Días que CloudWatch guarda los logs de las funciones."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.log_retention_days)
    error_message = "CloudWatch acepta 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180 o 365 días."
  }
}

variable "access_logs_expiration_days" {
  description = "Días que se guardan los registros de acceso de los buckets."
  type        = number
  default     = 30

  validation {
    condition     = floor(var.access_logs_expiration_days) == var.access_logs_expiration_days && var.access_logs_expiration_days >= 1
    error_message = "Tiene que ser una cantidad entera de días, al menos 1."
  }
}

variable "site_throttle_rate_limit" {
  description = "Pedidos por segundo sostenidos a los archivos del sitio estático. No invocan Lambdas: puede ser alto, y tiene que serlo para que una sala entera escaneando el mismo QR cargue la página."
  type        = number
  default     = 500

  validation {
    condition     = var.site_throttle_rate_limit > 0
    error_message = "Tiene que ser positivo."
  }

  validation {
    condition     = var.site_throttle_rate_limit >= var.api_throttle_rate_limit
    error_message = "El sitio no invoca Lambdas: su techo no puede ser más bajo que el de la API, o una sala escaneando el QR carga la página rota."
  }
}

variable "site_throttle_burst_limit" {
  description = "Ráfaga máxima de pedidos al sitio estático."
  type        = number
  default     = 1000

  validation {
    condition     = floor(var.site_throttle_burst_limit) == var.site_throttle_burst_limit && var.site_throttle_burst_limit >= 1
    error_message = "La ráfaga es una cantidad entera de pedidos, al menos 1."
  }
}

variable "api_throttle_rate_limit" {
  description = "Pedidos por segundo sostenidos por ruta de la API (y en el WebSocket) antes de responder 429. A la medida de la concurrencia de Lambda del lab."
  type        = number
  default     = 25

  validation {
    condition     = var.api_throttle_rate_limit > 0
    error_message = "Tiene que ser positivo."
  }
}

variable "api_throttle_burst_limit" {
  description = "Ráfaga máxima por ruta de la API (y en el WebSocket)."
  type        = number
  default     = 50

  validation {
    condition     = floor(var.api_throttle_burst_limit) == var.api_throttle_burst_limit && var.api_throttle_burst_limit >= 1
    error_message = "La ráfaga es una cantidad entera de pedidos, al menos 1."
  }
}

variable "joins_per_minute" {
  description = "Uniones a una cola que acepta la API por IP y por minuto, antes de responder 429. Tiene que cubrir una sala entera detrás de la misma IP (el Wi-Fi de un local o de un aula sale por un único NAT)."
  type        = number
  default     = 60

  validation {
    condition     = floor(var.joins_per_minute) == var.joins_per_minute && var.joins_per_minute >= 1
    error_message = "Tiene que ser un entero y permitir al menos una unión por minuto."
  }
}

variable "public_write_rate_limit" {
  description = "Pedidos por segundo sostenidos en las rutas que escribe un cliente anónimo (unirse, salir)."
  type        = number
  default     = 10

  validation {
    condition     = var.public_write_rate_limit > 0
    error_message = "Tiene que ser positivo."
  }

  validation {
    condition     = var.public_write_rate_limit <= var.api_throttle_rate_limit
    error_message = "Las rutas que escribe cualquiera tienen un techo más bajo que el resto de la API: si fuera más alto, no protegería nada."
  }
}

variable "public_write_burst_limit" {
  description = "Ráfaga máxima en las rutas que escribe un cliente anónimo."
  type        = number
  default     = 20

  validation {
    condition     = floor(var.public_write_burst_limit) == var.public_write_burst_limit && var.public_write_burst_limit >= 1
    error_message = "La ráfaga es una cantidad entera de pedidos, al menos 1."
  }

  validation {
    condition     = var.public_write_burst_limit <= var.api_throttle_burst_limit
    error_message = "La ráfaga de las rutas anónimas no puede superar la del resto de la API."
  }
}

variable "session_hours" {
  description = "Horas que dura una sesión del staff antes de volver a iniciar sesión."
  type        = number
  default     = 12

  validation {
    condition     = floor(var.session_hours) == var.session_hours && var.session_hours >= 1 && var.session_hours <= 24
    error_message = "Cognito acepta tokens de 1 a 24 horas enteras."
  }
}

variable "demo_enabled" {
  description = "Carga un local de demo con dos colas y un usuario de staff, para poder probar sin configurar nada."
  type        = bool
  default     = true
}

variable "demo_email" {
  description = "Email del usuario de staff de demo. Se usa para iniciar sesión."
  type        = string
  default     = "demo@queue.example"

  validation {
    condition     = can(regex(local.email_pattern, var.demo_email))
    error_message = "El email de demo tiene que ser una dirección válida."
  }
}

variable "alert_email" {
  description = "Email que recibe las alarmas (mensajes en una DLQ, fallas del stream). null para no suscribir ninguno."
  type        = string
  default     = null

  validation {
    condition     = var.alert_email == null || can(regex(local.email_pattern, var.alert_email))
    error_message = "alert_email tiene que ser una dirección válida."
  }
}

variable "consumer_max_concurrency" {
  description = "Ejecuciones simultáneas como máximo de cada consumidor de cola. 2 es el mínimo que admite AWS."
  type        = number
  default     = 2

  validation {
    condition     = floor(var.consumer_max_concurrency) == var.consumer_max_concurrency && var.consumer_max_concurrency >= 2 && var.consumer_max_concurrency <= 1000
    error_message = "AWS admite un entero de 2 a 1000."
  }
}

variable "ses_sender_email" {
  description = "Remitente de los avisos a clientes. null deja los avisos simulados en los logs del notifier."
  type        = string
  default     = null

  validation {
    condition     = var.ses_sender_email == null || can(regex(local.email_pattern, var.ses_sender_email))
    error_message = "ses_sender_email tiene que ser una dirección válida."
  }
}

variable "smtp_sender_email" {
  description = "Cuenta de Gmail que manda los avisos por SMTP, en lugar de SES (que el Learner Lab niega). Su contraseña de aplicación la carga el pipeline en Secrets Manager. null deja los avisos simulados."
  type        = string
  default     = null

  validation {
    condition     = var.smtp_sender_email == null || can(regex(local.email_pattern, var.smtp_sender_email))
    error_message = "smtp_sender_email tiene que ser una dirección válida."
  }
}

variable "ses_verified_recipients" {
  description = "Direcciones que pueden recibir avisos reales mientras la cuenta esté en el sandbox de SES (las del grupo)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for email in var.ses_verified_recipients : can(regex(local.email_pattern, email))])
    error_message = "Todas las direcciones tienen que ser válidas."
  }
}
