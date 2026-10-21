# terraform/organization

La configuración raíz de la infraestructura de Queue: la que se inicializa, se planifica y se
aplica. **La documentación de la entrega está en el
[README principal](../../README.md#4-terraform)**: módulos, funciones, meta-argumentos, variables,
outputs, estado remoto, pipeline y la guía paso a paso.

| Qué | Dónde |
|---|---|
| Módulos propios, cada uno con su README y sus tests | [`terraform/modules/lambda-function`](../modules/lambda-function/README.md), [`terraform/modules/private-bucket`](../modules/private-bucket/README.md), [`terraform/modules/queue-with-dlq`](../modules/queue-with-dlq/README.md) |
| Módulo externo | `terraform-aws-modules/dynamodb-table/aws` `5.5.2`, en [`tables.tf`](tables.tf) |
| Creación y borrado de los buckets de la app | [`scripts/buckets.sh`](scripts/buckets.sh) (ver [por qué](../../README.md#48-lo-que-no-crea-terraform-y-por-qué)) |
| Datos de demo | [`seed/demo.json`](seed/demo.json) |
| Tests de la raíz | [`tests/`](tests/) |
| Valores que se pueden cambiar | [`terraform.tfvars.example`](terraform.tfvars.example) |

Para revisar la configuración sin desplegar (no usa AWS):

```bash
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
terraform test
for module in ../modules/*/; do (cd "$module" && terraform init -backend=false && terraform test); done
```

El despliegue se hace desde el pipeline, no desde una máquina local: ver la
[guía paso a paso](../../README.md#6-guía-paso-a-paso).
