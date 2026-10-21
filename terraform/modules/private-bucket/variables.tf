variable "name" {
  description = "Nombre del bucket. Tiene que ser único en todo S3, por eso la raíz le agrega la cuenta y la región."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.name))
    error_message = "El nombre de un bucket va de 3 a 63 caracteres: minúsculas, números, puntos y guiones."
  }
}


variable "versioning_enabled" {
  description = "Guarda las versiones anteriores de cada objeto, para poder volver atrás."
  type        = bool
  default     = true
}

variable "expiration_days" {
  description = "Si se indica, los objetos (y sus versiones anteriores) se borran solos pasados estos días."
  type        = number
  default     = null

  validation {
    condition     = var.expiration_days == null || (floor(coalesce(var.expiration_days, 0)) == var.expiration_days && coalesce(var.expiration_days, 0) >= 1)
    error_message = "Una cantidad entera de días, al menos 1, o null para no expirar."
  }
}

variable "access_logs_bucket" {
  description = "Bucket que recibe los registros de acceso de este. null los desactiva. Se pasa el nombre y no el id del recurso para que `count` se pueda evaluar en el plan."
  type        = string
  default     = null
}

variable "access_logs_prefix" {
  description = "Prefijo bajo el cual se escriben los registros de acceso en el bucket destino."
  type        = string
  default     = ""
}

variable "additional_policy_documents" {
  description = "Documentos de política (JSON) que se suman a la política base del bucket, por ejemplo para permitir que S3 entregue registros de acceso."
  type        = list(string)
  default     = []
}

