variable "name" {
  description = "Nombre de la cola, sin el sufijo .fifo (el módulo lo agrega si `fifo` es true)."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,70}$", var.name))
    error_message = "El nombre admite hasta 70 letras, números, guiones y guiones bajos (SQS suma .fifo y -dlq)."
  }
}

variable "fifo" {
  description = "Cola FIFO: entrega en orden dentro de cada grupo de mensajes."
  type        = bool
  default     = false
}

variable "visibility_timeout_seconds" {
  description = "Cuánto queda oculto un mensaje mientras se procesa. AWS recomienda 6 veces el timeout de la función que lo consume."
  type        = number

  validation {
    condition     = floor(var.visibility_timeout_seconds) == var.visibility_timeout_seconds && var.visibility_timeout_seconds >= 0 && var.visibility_timeout_seconds <= 43200
    error_message = "SQS acepta de 0 a 43200 segundos, enteros."
  }
}

variable "max_receive_count" {
  description = "Intentos antes de mover un mensaje a la DLQ. Sin tope, uno que siempre falla se reintentaría para siempre, y cada intento se paga."
  type        = number
  default     = 5

  validation {
    condition     = floor(var.max_receive_count) == var.max_receive_count && var.max_receive_count >= 1 && var.max_receive_count <= 1000
    error_message = "SQS acepta de 1 a 1000 intentos, enteros."
  }
}

variable "message_retention_seconds" {
  description = "Cuánto se guarda un mensaje sin consumir."
  type        = number
  default     = 345600

  validation {
    condition     = floor(var.message_retention_seconds) == var.message_retention_seconds && var.message_retention_seconds >= 60 && var.message_retention_seconds <= 1209600
    error_message = "SQS acepta de 60 segundos a 14 días (1209600), enteros."
  }
}

variable "dlq_retention_seconds" {
  description = "Cuánto se guarda un mensaje en la DLQ: el máximo, para tener tiempo de investigarlo."
  type        = number
  default     = 1209600

  validation {
    condition     = floor(var.dlq_retention_seconds) == var.dlq_retention_seconds && var.dlq_retention_seconds >= 60 && var.dlq_retention_seconds <= 1209600
    error_message = "SQS acepta de 60 segundos a 14 días (1209600), enteros."
  }

  validation {
    condition     = var.dlq_retention_seconds > var.message_retention_seconds
    error_message = "La DLQ tiene que guardar más tiempo que su cola: en una cola estándar, un mensaje conserva su antigüedad al pasar a la DLQ, y con una retención igual o menor vencería apenas llega."
  }
}

variable "publisher_topic_arns" {
  description = "Tópicos SNS que pueden publicar en la cola. Se permite solo a esos, y solo desde esta cuenta."
  type        = list(string)
  default     = []
}

variable "alarm_topic_arn" {
  description = "Tópico SNS que recibe las alarmas."
  type        = string
}

variable "max_message_age_seconds" {
  description = "Si se indica, alarma cuando el mensaje más viejo de la cola espera más que esto: el consumidor se atrasó."
  type        = number
  default     = null

  validation {
    condition     = var.max_message_age_seconds == null || (floor(coalesce(var.max_message_age_seconds, 0)) == var.max_message_age_seconds && coalesce(var.max_message_age_seconds, 0) >= 1)
    error_message = "El umbral es una cantidad entera de segundos, al menos 1, o null para no crear la alarma."
  }
}

variable "tags" {
  description = "Tags propios de las colas, además de los que el provider aplica a todo."
  type        = map(string)
  default     = {}
}
