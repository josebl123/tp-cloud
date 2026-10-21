# Módulo `lambda-function`

Una función Lambda en Node.js con las decisiones que comparten todas las de Queue.

- **El paquete se guarda versionado en el bucket de artefactos.** El bundle de esbuild se zipea con
  el datasource `archive_file`, se sube a `lambdas/<nombre>.zip` y la función apunta a esa versión
  exacta del objeto (`s3_object_version`). Cada carga del paquete genera una versión del objeto; la Lambda usa esa versión de S3, no un alias de versión publicada de Lambda.
- **Log group propio, con retención.** Si lo creara Lambda sola, no tendría retención y los logs se
  guardarían para siempre.
- **Rol recibido como entrada; la raíz usa `LabRole`.** El Learner Lab no permite crear roles, así que el rol se recibe como entrada
  en lugar de crearse acá.
- **arm64 por defecto.** El código es JavaScript puro, así que corre igual en Graviton, que cuesta
  menos por milisegundo.

## Uso

```hcl
module "public_example" {
  source = "../modules/lambda-function"

  name             = "q-public-example"
  source_file      = "../../functions/dist/public/index.mjs"
  role_arn         = data.aws_iam_role.lab.arn
  artifacts_bucket = module.private_buckets["artifacts"].name
  environment      = { TABLE_NAME = module.main_table.dynamodb_table_id }
}
```

El ejemplo supone ejecución desde la raíz Terraform, bundles compilados y el bucket de artefactos
configurado con versionado. Las llamadas vigentes están en [functions.tf](../../organization/functions.tf) y
[auth.tf](../../organization/auth.tf). El rol se recibe como entrada: `LabRole` es la elección de esta raíz,
no un nombre impuesto por el módulo.


## Decisiones

- **`depends_on` hacia el log group.** La función escribe en `/aws/lambda/<nombre>` por convención,
  sin referenciar al recurso. Sin `depends_on`, una invocación temprana haría que Lambda creara el
  log group sola, y el siguiente `apply` fallaría al intentar crearlo.
- **`dynamic "environment"`.** El bloque solo se genera si hay variables: un bloque vacío hace que
  el provider muestre un cambio en cada `plan`.

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
| <a name="requirement_archive"></a> [archive](#requirement\_archive) | >= 2.4 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 6.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_archive"></a> [archive](#provider\_archive) | 2.8.1 |
| <a name="provider_aws"></a> [aws](#provider\_aws) | 6.67.0 |

## Modules

No modules.

## Resources

| Name | Type |
|------|------|
| [aws_cloudwatch_log_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_log_group) | resource |
| [aws_lambda_function.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function) | resource |
| [aws_s3_object.package](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_object) | resource |
| [archive_file.this](https://registry.terraform.io/providers/hashicorp/archive/latest/docs/data-sources/file) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_architecture"></a> [architecture](#input\_architecture) | Arquitectura del procesador. arm64 (Graviton) cuesta menos por milisegundo y el código es JavaScript puro. | `string` | `"arm64"` | no |
| <a name="input_artifacts_bucket"></a> [artifacts\_bucket](#input\_artifacts\_bucket) | Bucket donde se guarda el zip de la función. Tiene versionado, así que cada despliegue queda como una versión. | `string` | n/a | yes |
| <a name="input_description"></a> [description](#input\_description) | Qué hace la función, tal como se ve en la consola. | `string` | `""` | no |
| <a name="input_environment"></a> [environment](#input\_environment) | Variables de entorno. Nunca secretos: se ven en la consola en texto plano. | `map(string)` | `{}` | no |
| <a name="input_handler"></a> [handler](#input\_handler) | Función exportada que invoca Lambda, en formato archivo.función. | `string` | `"index.handler"` | no |
| <a name="input_log_retention_days"></a> [log\_retention\_days](#input\_log\_retention\_days) | Días que CloudWatch guarda los logs de la función. | `number` | `14` | no |
| <a name="input_memory_size"></a> [memory\_size](#input\_memory\_size) | Memoria en MB. Lambda asigna CPU en proporción a la memoria. | `number` | `256` | no |
| <a name="input_name"></a> [name](#input\_name) | Nombre de la función en AWS. | `string` | n/a | yes |
| <a name="input_role_arn"></a> [role\_arn](#input\_role\_arn) | Rol de ejecución. En el Learner Lab siempre es LabRole, porque no se pueden crear roles. | `string` | n/a | yes |
| <a name="input_runtime"></a> [runtime](#input\_runtime) | Runtime de Lambda. | `string` | `"nodejs22.x"` | no |
| <a name="input_source_file"></a> [source\_file](#input\_source\_file) | Ruta al archivo ya empaquetado por esbuild (un único .mjs con todas sus dependencias). | `string` | n/a | yes |
| <a name="input_tags"></a> [tags](#input\_tags) | Tags propios de la función, además de los que el provider aplica a todo. | `map(string)` | `{}` | no |
| <a name="input_timeout"></a> [timeout](#input\_timeout) | Tiempo máximo de ejecución en segundos. | `number` | `10` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_arn"></a> [arn](#output\_arn) | ARN de la función. |
| <a name="output_invoke_arn"></a> [invoke\_arn](#output\_invoke\_arn) | ARN que usa API Gateway para invocarla. |
| <a name="output_log_group_name"></a> [log\_group\_name](#output\_log\_group\_name) | Log group donde escribe la función. |
| <a name="output_name"></a> [name](#output\_name) | Nombre de la función. |
| <a name="output_source_code_hash"></a> [source\_code\_hash](#output\_source\_code\_hash) | Hash del bundle desplegado. Cambia cuando cambia el código, así quien dependa de él (la carga de demo, por ejemplo) puede reaccionar. |
<!-- END_TF_DOCS -->
