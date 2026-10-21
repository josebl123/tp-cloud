# La tabla principal, con el módulo externo de la comunidad. Su forma es la del diseño de tabla
# única: claves genéricas PK y SK, Streams para el bus de eventos, PITR para poder volver a
# cualquier segundo de los últimos 35 días, y TTL para los ítems que vencen.
#
# DynamoDB cifra siempre en reposo, con una clave de AWS. tfsec pide además una clave KMS, que suma un
# costo por pedido sin cambiar qué datos quedan protegidos.
#tfsec:ignore:aws-dynamodb-enable-at-rest-encryption
module "main_table" {
  source  = "terraform-aws-modules/dynamodb-table/aws"
  version = "5.5.2"

  name         = format("%s-main", var.project)
  hash_key     = "PK"
  range_key    = "SK"
  billing_mode = "PAY_PER_REQUEST"

  attributes = [
    { name = "PK", type = "S" },
    { name = "SK", type = "S" },
  ]

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  point_in_time_recovery_enabled = true

  ttl_enabled        = true
  ttl_attribute_name = "ttl"

  # La cátedra tiene que poder destruir todo.
  deletion_protection_enabled = false
}

# Las conexiones WebSocket: una por navegador abierto, indexadas por la cola que miran. El
# broadcaster hace una sola consulta al índice `byQueue` para encontrar a todos los que hay que
# avisar. El índice es eventualmente consistente a propósito: la primera vista de cada pantalla
# llega por REST, así que perderse el primer push no deja a nadie desactualizado.
#
# El TTL limpia las conexiones cuyo $disconnect nunca llegó. Puede tardar, pero acá no importa: el
# broadcaster también borra una conexión cuando API Gateway responde 410.
#
# Cifrada en reposo por DynamoDB, como la principal. Sin PITR, a propósito: guarda sockets que vencen
# en dos horas, no hay nada que recuperar.
#tfsec:ignore:aws-dynamodb-enable-at-rest-encryption
#tfsec:ignore:aws-dynamodb-enable-recovery
module "connections_table" {
  source  = "terraform-aws-modules/dynamodb-table/aws"
  version = "5.5.2"

  name         = format("%s-connections", var.project)
  hash_key     = "PK"
  billing_mode = "PAY_PER_REQUEST"

  attributes = [
    { name = "PK", type = "S" },
    { name = "queueId", type = "S" },
  ]

  global_secondary_indexes = [
    {
      name            = "byQueue"
      hash_key        = "queueId"
      projection_type = "ALL"
    },
  ]

  ttl_enabled        = true
  ttl_attribute_name = "ttl"

  deletion_protection_enabled = false
}
