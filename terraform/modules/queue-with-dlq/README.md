# Módulo `queue-with-dlq`

Una cola SQS de trabajo con DLQ, redrive, permisos de publicación y alarmas.

| Siempre | Opcional |
|---|---|
| DLQ propia, FIFO si la cola es FIFO | Permiso para que ciertos tópicos SNS publiquen (`publisher_topic_arns`) |
| Tope de intentos (`max_receive_count`) antes de pasar a la DLQ | Alarma si el mensaje más viejo espera demasiado (`max_message_age_seconds`) |
| La DLQ solo acepta mensajes de su cola | |
| Alarma de mensajes visibles en la DLQ, evaluada cada 60 segundos | |
| Cola y DLQ cifradas en reposo con la clave de SQS (SSE-SQS) | |

## Uso

```hcl
module "notifications" {
  source = "../modules/queue-with-dlq"

  name                       = "q-notifications"
  visibility_timeout_seconds = 180
  publisher_topic_arns       = [aws_sns_topic.queue_events.arn]
  alarm_topic_arn            = aws_sns_topic.alerts.arn
}
```

El ejemplo se evalúa desde la raíz Terraform, donde existen los tópicos referenciados.
El uso vigente de las tres colas está en [events.tf](../../organization/events.tf). El módulo configura
visibilidad, pero no la deriva del timeout de una Lambda: la raíz pasa seis veces el timeout
del consumidor.


## Decisiones

- **El tope de recepciones no es opcional.** Permite mover un mensaje repetidamente fallido a la
  DLQ antes de agotar su retención. No equivale al número de intentos internos de una notificación.
- **Las alarmas necesitan un receptor operativo.** Se publican al tópico indicado; para email hay
  que configurar y confirmar la suscripción SNS. El umbral de edad de 10 segundos en push se evalúa
  en períodos de 60 segundos, no garantiza una alerta a los 10 segundos.
- **La DLQ no recupera errores reconocidos como éxito.** Los consumidores deben reportar las fallas
  que quieran reintentar. Los errores WebSocket por conexión actualmente se registran y absorben.
- **La política de la cola solo admite los tópicos indicados**, con la condición `aws:SourceArn`:
  ningún otro tópico, de esta cuenta o de otra, puede publicar.
- **`count` para lo opcional:** la política existe solo si hay publicadores, y la alarma de atraso
  solo si se pide.
- **La DLQ guarda más tiempo que su cola, y se valida.** En una cola estándar, un mensaje conserva
  su antigüedad al pasar a la DLQ: una retención igual o menor reduce el tiempo disponible para
  investigarlo y puede hacer que venza poco después de llegar.

## Tests

`terraform test` en esta carpeta, en modo plan y con el provider simulado: no necesita AWS. El
lockfile de esta carpeta fija sus providers; los tests corren desde el pipeline en los eventos
que ejecutan el job de validación.

## Referencia

Entradas, salidas, recursos y versiones, generados con
[terraform-docs](https://terraform-docs.io) a partir del código del módulo.

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.10.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 6.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | 6.67.0 |

## Modules

No modules.

## Resources

| Name | Type |
|------|------|
| [aws_cloudwatch_metric_alarm.dlq_not_empty](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.oldest_message](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_sqs_queue.dlq](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue) | resource |
| [aws_sqs_queue.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue) | resource |
| [aws_sqs_queue_policy.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue_policy) | resource |
| [aws_sqs_queue_redrive_allow_policy.dlq](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue_redrive_allow_policy) | resource |
| [aws_iam_policy_document.publishers](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_alarm_topic_arn"></a> [alarm\_topic\_arn](#input\_alarm\_topic\_arn) | Tópico SNS que recibe las alarmas. | `string` | n/a | yes |
| <a name="input_dlq_retention_seconds"></a> [dlq\_retention\_seconds](#input\_dlq\_retention\_seconds) | Cuánto se guarda un mensaje en la DLQ: el máximo, para tener tiempo de investigarlo. | `number` | `1209600` | no |
| <a name="input_fifo"></a> [fifo](#input\_fifo) | Cola FIFO: entrega en orden dentro de cada grupo de mensajes. | `bool` | `false` | no |
| <a name="input_max_message_age_seconds"></a> [max\_message\_age\_seconds](#input\_max\_message\_age\_seconds) | Si se indica, alarma cuando el mensaje más viejo de la cola espera más que esto: el consumidor se atrasó. | `number` | `null` | no |
| <a name="input_max_receive_count"></a> [max\_receive\_count](#input\_max\_receive\_count) | Intentos antes de mover un mensaje a la DLQ. Sin tope, uno que siempre falla se reintentaría para siempre, y cada intento se paga. | `number` | `5` | no |
| <a name="input_message_retention_seconds"></a> [message\_retention\_seconds](#input\_message\_retention\_seconds) | Cuánto se guarda un mensaje sin consumir. | `number` | `345600` | no |
| <a name="input_name"></a> [name](#input\_name) | Nombre de la cola, sin el sufijo .fifo (el módulo lo agrega si `fifo` es true). | `string` | n/a | yes |
| <a name="input_publisher_topic_arns"></a> [publisher\_topic\_arns](#input\_publisher\_topic\_arns) | Tópicos SNS que pueden publicar en la cola. Se permite solo a esos, y solo desde esta cuenta. | `list(string)` | `[]` | no |
| <a name="input_tags"></a> [tags](#input\_tags) | Tags propios de las colas, además de los que el provider aplica a todo. | `map(string)` | `{}` | no |
| <a name="input_visibility_timeout_seconds"></a> [visibility\_timeout\_seconds](#input\_visibility\_timeout\_seconds) | Cuánto queda oculto un mensaje mientras se procesa. AWS recomienda 6 veces el timeout de la función que lo consume. | `number` | n/a | yes |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_arn"></a> [arn](#output\_arn) | ARN de la cola, para suscribirla a SNS o conectarle una Lambda. |
| <a name="output_dlq_arn"></a> [dlq\_arn](#output\_dlq\_arn) | ARN de la DLQ. |
| <a name="output_dlq_url"></a> [dlq\_url](#output\_dlq\_url) | URL de la DLQ, para inspeccionar o redirigir sus mensajes. |
| <a name="output_name"></a> [name](#output\_name) | Nombre de la cola. |
| <a name="output_url"></a> [url](#output\_url) | URL de la cola, la que usa el SDK para enviar mensajes. |
<!-- END_TF_DOCS -->
