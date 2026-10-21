variable "name" {
  description = "Nombre de la función en AWS."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,64}$", var.name))
    error_message = "El nombre de una función Lambda admite hasta 64 letras, números, guiones y guiones bajos."
  }
}

variable "description" {
  description = "Qué hace la función, tal como se ve en la consola."
  type        = string
  default     = ""
}

variable "source_file" {
  description = "Ruta al archivo ya empaquetado por esbuild (un único .mjs con todas sus dependencias)."
  type        = string
}

variable "handler" {
  description = "Función exportada que invoca Lambda, en formato archivo.función."
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Runtime de Lambda."
  type        = string
  default     = "nodejs22.x"

  validation {
    condition     = startswith(var.runtime, "nodejs")
    error_message = "Todas las funciones de Queue son Node.js."
  }
}

variable "architecture" {
  description = "Arquitectura del procesador. arm64 (Graviton) cuesta menos por milisegundo y el código es JavaScript puro."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.architecture)
    error_message = "La arquitectura tiene que ser arm64 o x86_64."
  }
}

variable "memory_size" {
  description = "Memoria en MB. Lambda asigna CPU en proporción a la memoria."
  type        = number
  default     = 256

  validation {
    condition     = floor(var.memory_size) == var.memory_size && var.memory_size >= 128 && var.memory_size <= 10240
    error_message = "Lambda acepta de 128 a 10240 MB, enteros."
  }
}

variable "timeout" {
  description = "Tiempo máximo de ejecución en segundos."
  type        = number
  default     = 10

  validation {
    condition     = floor(var.timeout) == var.timeout && var.timeout >= 1 && var.timeout <= 900
    error_message = "Lambda acepta de 1 a 900 segundos, enteros."
  }
}

variable "environment" {
  description = "Variables de entorno. Nunca secretos: se ven en la consola en texto plano."
  type        = map(string)
  default     = {}
}

variable "role_arn" {
  description = "Rol de ejecución. En el Learner Lab siempre es LabRole, porque no se pueden crear roles."
  type        = string
}

variable "artifacts_bucket" {
  description = "Bucket donde se guarda el zip de la función. Tiene versionado, así que cada despliegue queda como una versión."
  type        = string
}

variable "log_retention_days" {
  description = "Días que CloudWatch guarda los logs de la función."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.log_retention_days)
    error_message = "CloudWatch solo acepta ciertos valores de retención: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180 o 365."
  }
}

variable "tags" {
  description = "Tags propios de la función, además de los que el provider aplica a todo."
  type        = map(string)
  default     = {}
}
