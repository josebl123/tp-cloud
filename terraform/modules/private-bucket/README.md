# Módulo `private-bucket`

Las decisiones que comparten todos los buckets de Queue, aplicadas sobre un bucket **que ya existe**.

El módulo no crea el bucket. Después de crear un `aws_s3_bucket`, el provider de AWS lee su
configuración de object lock, y el SCP del Learner Lab niega esa lectura con un deny explícito
(`s3:GetBucketObjectLockConfiguration`). Las versiones ensayadas en el lab del grupo (v4.67, v5.100 y v6.67)
fallaron ante ese `AccessDenied`; esto no establece el comportamiento de toda versión futura ni
de otra cuenta. Las demás lecturas probadas estaban permitidas, así que el pipeline crea el bucket vacío
([`scripts/buckets.sh`](../../organization/scripts/buckets.sh)) y este módulo administra todo lo que va encima.

| Siempre | Opcional |
|---|---|
| Bloqueo de todo acceso público | Versionado (`versioning_enabled`, encendido por defecto) |
| Propiedad de los objetos de la cuenta, sin ACLs | Expiración de objetos y versiones (`expiration_days`) |
| Política que rechaza todo pedido que no use TLS | Registros de acceso hacia otro bucket (`access_logs_bucket`) |
| | Statements extra en la política (`additional_policy_documents`) |

## Uso

```hcl
module "logs" {
  source = "../modules/private-bucket"

  name            = "q-logs-123456789012-us-east-1" # tiene que existir antes del apply
  expiration_days = 30
}
```

El ejemplo se evalúa desde la raíz Terraform y usa un nombre ilustrativo, que debe reemplazarse.
Los usos vigentes están en [storage.tf](../../organization/storage.tf); los nombres reales se derivan de la
cuenta, región y prefijo.


## Decisiones

- **El bucket se recibe, no se crea.** Ver arriba. Por eso no hay `force_destroy` ni `tags`: los dos
  eran atributos de `aws_s3_bucket`. El pipeline vacía y borra los buckets después del `destroy`. El
  ARN se arma con `data "aws_partition"`, que no consulta la API.

- **`count` para lo opcional.** Versionado, expiración y registros de acceso son recursos aparte en
  el provider 6 de AWS; crearlos solo cuando se piden evita configuraciones vacías.
- **`access_logs_bucket` recibe un nombre, no un id.** `count` tiene que poder evaluarse en el
  `plan`, y el id de un bucket que todavía no existe recién se conoce en el `apply`. Por eso quien
  llama al módulo debe garantizar que el destino y su política estén preparados. La raíz pasa
  `module.logs_bucket.name`, cuyo output espera al versionado y la política, sin depender de todo
  el módulo. Otras opciones del bucket no forman parte de esa garantía.
- **El output `name` espera al versionado y a la política** (`depends_on` en el output). Quien usa
  el nombre no ve esos recursos, y un objeto subido antes de activar el versionado quedaría sin
  `version_id`, que es lo que usa una Lambda para apuntar a su zip.
- **`depends_on` entre la política y el bloqueo de acceso público.** No hay referencia entre los dos,
  y S3 rechaza dos cambios de configuración simultáneos sobre el mismo bucket.
- **Las dos salidas tienen contratos distintos a propósito.** `arn` se arma del nombre y se conoce
  en el plan, así una política que lo nombra no espera a nada; `name` lleva el `depends_on`, porque
  es el que se usa para escribir.

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
| [aws_s3_bucket_lifecycle_configuration.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_lifecycle_configuration) | resource |
| [aws_s3_bucket_logging.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_logging) | resource |
| [aws_s3_bucket_ownership_controls.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_ownership_controls) | resource |
| [aws_s3_bucket_policy.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy) | resource |
| [aws_s3_bucket_public_access_block.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block) | resource |
| [aws_s3_bucket_versioning.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) | resource |
| [aws_iam_policy_document.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_partition.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/partition) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_access_logs_bucket"></a> [access\_logs\_bucket](#input\_access\_logs\_bucket) | Bucket que recibe los registros de acceso de este. null los desactiva. Se pasa el nombre y no el id del recurso para que `count` se pueda evaluar en el plan. | `string` | `null` | no |
| <a name="input_access_logs_prefix"></a> [access\_logs\_prefix](#input\_access\_logs\_prefix) | Prefijo bajo el cual se escriben los registros de acceso en el bucket destino. | `string` | `""` | no |
| <a name="input_additional_policy_documents"></a> [additional\_policy\_documents](#input\_additional\_policy\_documents) | Documentos de política (JSON) que se suman a la política base del bucket, por ejemplo para permitir que S3 entregue registros de acceso. | `list(string)` | `[]` | no |
| <a name="input_expiration_days"></a> [expiration\_days](#input\_expiration\_days) | Si se indica, los objetos (y sus versiones anteriores) se borran solos pasados estos días. | `number` | `null` | no |
| <a name="input_name"></a> [name](#input\_name) | Nombre del bucket. Tiene que ser único en todo S3, por eso la raíz le agrega la cuenta y la región. | `string` | n/a | yes |
| <a name="input_versioning_enabled"></a> [versioning\_enabled](#input\_versioning\_enabled) | Guarda las versiones anteriores de cada objeto, para poder volver atrás. | `bool` | `true` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_arn"></a> [arn](#output\_arn) | ARN del bucket, para políticas e integraciones. |
| <a name="output_name"></a> [name](#output\_name) | Nombre del bucket. Se entrega recién cuando el bucket está configurado del todo. |
<!-- END_TF_DOCS -->
