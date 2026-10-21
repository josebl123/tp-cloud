# Avance de la entrega 3

Registro de lo hecho sobre la rama `entrega-3`, fase por fase, contra el [ROADMAP](ROADMAP.md). Cada
fase anota qué se construyó, qué se decidió en el camino y por qué, qué se verificó y qué falta.

| Fase | Estado |
|---|---|
| 1 · Esqueleto que camina: Terraform y pipeline | **Código completo y verificado localmente.** **Desplegada en el lab por el pipeline, con la prueba de humo en verde** (ver *Primera corrida en el lab*) |
| 2 · Dominio y persistencia en DynamoDB | **Completa y verificada localmente** (94 tests, DynamoDB Local). **Desplegada en el lab por el pipeline, con la prueba de humo en verde** (ver *Primera corrida en el lab*) |
| 3 · API síncrona y Cognito | **Código completo y verificado localmente** (104 tests, bundles probados contra DynamoDB Local). **Desplegada en el lab por el pipeline, con la prueba de humo en verde** (ver *Primera corrida en el lab*) |
| 4 · Bus de eventos | **Código completo y verificado localmente** (109 tests, el stream real de DynamoDB Local). **Desplegada en el lab por el pipeline, con la prueba de humo en verde** (ver *Primera corrida en el lab*) |
| 5 · Consumidores y tiempo real | **Código completo y verificado localmente** (116 tests, los 9 bundles cargan). **Desplegada en el lab por el pipeline, con la prueba de humo en verde** (ver *Primera corrida en el lab*) |
| 6 · Retirar lo anterior | **Completa en el repositorio** (ver *Fase 6*). Falta la parte del lab: borrar lo que quedó del TP2 y el `app.env`, y revocar la contraseña de Gmail |
| 7 · Entrega | Pendiente |

---

## Fase 1 · Esqueleto que camina

### Qué se construyó

```
.github/
  actions/terraform-init/action.yml   credenciales, bucket del estado e init (compartido)
  workflows/terraform.yml             validate, build, plan, apply, destroy
functions/                            las Lambdas en TypeScript
  build.mjs                           esbuild: un bundle por handler
  src/handlers/health.ts              escribe y lee la tabla principal
infra/terraform/
  versions.tf · backend.tf · providers.tf
  variables.tf · locals.tf · data.tf · outputs.tf · terraform.tfvars.example
  storage.tf     los tres buckets privados
  tables.tf      la tabla principal, con el módulo externo
  functions.tf   las funciones, con el módulo propio
  site.tf        el build del frontend en el bucket del sitio
  api.tf         API REST: el sitio y /api/v1/health
  .tflint.hcl
  modules/private-bucket/             módulo propio, con README
  modules/lambda-function/            módulo propio, con README
frontend/next.config.ts               ruta base configurable
frontend/src/app/q/page.tsx           la navegación manual respeta la ruta base
```

Al desplegar queda andando:

| Recurso | Para qué |
|---|---|
| Buckets `q-spa-…`, `q-artefactos-…`, `q-logs-…` | Sitio, zips de las Lambdas (versionados), registros de acceso de los otros dos (expiran a 30 días) |
| Tabla `q-main` | La tabla definitiva: PK/SK genéricas, Streams, PITR y TTL |
| Función `q-health` | Prueba de humo de API Gateway → Lambda → DynamoDB |
| API REST `q-api`, stage `prod` | El sitio en `/prod/` y la salud en `/prod/api/v1/health` |

### Decisiones que se apartan del roadmap

1. **La tabla principal real en lugar de una tabla de prueba.** El diseño de §5 usa claves
   genéricas (`PK` y `SK` como strings), Streams, PITR y TTL: nada de eso cambia en las fases
   siguientes. Crearla ahora evita un recurso descartable y deja usado el módulo externo (10 % de
   la rúbrica) desde la primera fase. El ítem de la prueba de humo vence solo a la hora por TTL.
2. **Sin alias ni SnapStart.** Eran para Java. Con Node, API Gateway invoca la función directamente.
3. **Dos rutas para el sitio en lugar de una por página.** No está documentado cómo resuelve
   API Gateway REST un pedido como `/login/index.txt` cuando existen a la vez un recurso `/login` y
   un `/{proxy+}`, y Next pide esos `.txt` en cada navegación. En lugar de arriesgarlo, hay solo dos
   rutas (la raíz y `/{proxy+}`), y cada página se sube **además** con su ruta como clave, con y sin
   barra final: `login/index.html` también existe como `login/` y como `login`. Son 20 objetos más
   (108 en total) y ninguna regla de ruteo.
4. **Los zips de las funciones se guardan en el bucket de artefactos**, versionado, y cada función
   apunta a la versión exacta del objeto. Así el bucket tiene un uso real y cada despliegue queda
   registrado.
5. **El código de las Lambdas va en `functions/`**, separado de `backend/` (Java), que se retira en
   la Fase 6.
6. **La ruta base del frontend sale de `NEXT_PUBLIC_BASE_PATH`.** En desarrollo queda vacía; el
   pipeline compila con `/prod`. `NEXT_PUBLIC_API_URL=/prod` hace que la API se llame por la misma
   URL, sin tocar `api.ts`; la Fase 3 lo reemplaza por `config.json`.
7. **El pipeline aplica exactamente el plan revisado.** El plan se guarda como artefacto junto con
   los zips de las funciones (el plan los referencia y en otro runner no existirían), y el `apply`
   corre ese archivo, no un plan nuevo.
8. **Lo común a plan, apply y destroy está en una action propia** (`terraform-init`): instalar
   Terraform, cargar las credenciales, crear el bucket del estado si no existe e inicializar. Tres
   jobs, una sola definición.

### Versiones fijadas

Todas publicadas hace al menos dos semanas al momento de elegirlas.

| Pieza | Versión |
|---|---|
| Terraform | 1.16.4 (`required_version >= 1.10, < 2.0`) |
| Provider `hashicorp/aws` | 6.67.0 (`~> 6.67.0`) |
| Provider `hashicorp/archive` | 2.8.1 (`~> 2.8.0`) |
| Módulo `terraform-aws-modules/dynamodb-table/aws` | 5.5.2 |
| tflint / ruleset AWS | 0.64.0 / 0.49.0 |
| Runtime de Lambda | `nodejs22.x`, arm64 |
| esbuild / TypeScript | 0.28.2 / 5.9.3 |
| Actions | checkout 7.0.1 · setup-node 7.0.0 · setup-terraform 4.0.1 · configure-aws-credentials 6.3.0 · setup-tflint 6.3.1 · upload-artifact 7.0.1 · download-artifact 8.0.1 · github-script 9.0.0 |

`.terraform.lock.hcl` está commiteado con los hashes de Linux, macOS y Windows, así cualquiera del
grupo y la cátedra usan los mismos providers.

### Verificado localmente

| Qué | Resultado |
|---|---|
| `terraform fmt -check -recursive` | Sin diferencias |
| `terraform validate` | Válido |
| `tflint --recursive` (presets `terraform` y `aws`) | Sin advertencias |
| `actionlint` sobre el workflow y la action | Sin errores |
| `functions`: typecheck y build | Bundle de 1,5 KB |
| `health` contra DynamoDB Local | 200: escribe, relee con lectura fuerte y coincide |
| Frontend: typecheck y build con `NEXT_PUBLIC_BASE_PATH=/prod` | Assets en `/prod/_next/…`, la redirección al ticket incluye `/prod` |
| Locals del sitio contra el build real | 88 archivos → 108 objetos; todos los tipos de archivo tienen content-type |

### Sin verificar: necesita el lab

Ninguna de estas cosas se puede probar sin credenciales de AWS. Son lo primero a mirar en la primera
ejecución del pipeline.

| Riesgo | Cómo se nota | Plan B |
|---|---|---|
| `LabRole` no puede ser asumido por API Gateway para leer S3 | El sitio responde 500 y el log de ejecución de API Gateway dice que no puede asumir el rol | Servir el sitio desde una Lambda Node mínima |
| API Gateway recorta o conserva la barra final del `{proxy+}` | Solo afecta qué clave se pide; están subidas las dos | — |
| S3 no entrega los registros de acceso | El bucket de logs queda vacío tras usar el sitio | Revisar la política de entrega (`data.tf`) |
| El lab bloquea alguna acción (como pasó con `StartInstanceRefresh` en el TP2) | `AccessDenied` en el `apply` | Depende de cuál |
| Límite de concurrencia de Lambda | — | Anotarlo: `aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions` |

### Para correrlo por primera vez

Una sola vez, en el repositorio de GitHub (requiere permisos de administrador):

1. **Secrets** (*Settings → Secrets and variables → Actions*): `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` y `AWS_SESSION_TOKEN`, copiados de *AWS Details* en el Learner Lab. Se
   actualizan en cada sesión nueva del lab.
2. **Environment `aws-lab`** (*Settings → Environments*) con *Required reviewers*. Lo configura
   y aprueba Jose (`josebl123`), dueño del repositorio. Sin revisores, el
   `apply` corre solo en cada push al PR. El repositorio es público, así que GitHub lo permite sin
   plan pago.
3. **Etiqueta `destroy`** (*Issues → Labels*), para poder destruir desde el PR.

Después: abrir un PR desde `entrega-3`, esperar `validate`, `build` y `plan`, aprobar el `apply`
en la ejecución, y revisar el resumen con las URLs. Para limpiar la cuenta, agregar la etiqueta
`destroy` al PR y aprobar.

### Rúbrica: lo que ya está cubierto

| Criterio | Dónde |
|---|---|
| Módulos propios | `private-bucket` ×3 (`storage.tf`), `lambda-function` ×1 (`functions.tf`); cada uno con `README.md`, `versions.tf`, variables tipadas y validadas |
| Módulo externo | `terraform-aws-modules/dynamodb-table/aws` 5.5.2 (`tables.tf`), usado dos veces desde la Fase 2: `q-main` y `q-connections` |
| `for_each` | `module.private_buckets`, `module.functions`, `aws_s3_object.site`, métodos, integraciones y respuestas del sitio (`api.tf`) |
| `count` | Versionado, expiración y registros de acceso opcionales dentro de `private-bucket` |
| `depends_on` | `module.private_buckets` → bucket de logs (`storage.tf`); política → bloqueo público (`private-bucket`); función → log group (`lambda-function`); output `name` → versionado y política (`private-bucket`); respuestas de integración → integraciones (`api.tf`). Cada uno con el motivo escrito al lado |
| `lifecycle` | `create_before_destroy` en el deployment de la API (`api.tf`) |
| Funciones | `format`, `merge`, `keys`, `values`, `fileset`, `endswith`, `startswith`, `trimsuffix`, `lookup`, `lower`, `regex`, `filemd5`, `setproduct`, `sha1`, `jsonencode`, `contains`, `can` |
| Locals | Sufijo de nombres, tags, mapa de buckets, mapa de funciones, tipos MIME, objetos del sitio, rutas del sitio y sus respuestas (`locals.tf`) |
| Datasources | `aws_caller_identity`, `aws_region`, `aws_iam_role` (`data.tf`); `aws_iam_policy_document` (`data.tf` y `private-bucket`); `archive_file` (`lambda-function`) |
| Calidad | `fmt`, `validate` y `tflint` en el pipeline; variables con `description` y `validation`; outputs con `description`; nada escrito a mano; un archivo por área |

---

## Fase 2 · Dominio y persistencia en DynamoDB

### Decisión previa: TypeScript en lugar de Java

El ROADMAP planeaba un proyecto Maven multimódulo (`q-domain`, `q-dynamo`, `q-fn-*`), pero la Fase 1
ya había puesto las Lambdas en TypeScript. Mantener dos lenguajes en las funciones no tenía sentido,
así que el dominio **se portó** de Java a TypeScript en lugar de extraerse. El ROADMAP quedó
actualizado (decisión "Lenguaje de las funciones" y ajustes 9 a 11).

### Qué se construyó

```
functions/
  src/domain/                lógica pura, sin AWS
    types.ts                 modelo: cola, carril, entrada, evento, aviso
    errors.ts                DomainError con los mismos `code` estables que la API Java
    ordering.ts              claves de orden fraccionarias
    lanes.ts                 elección de carril, capacidad, rangos anidados
    selector.ts              GLOBAL_AGE, LANE_PRIORITY, ROUND_ROBIN
    estimation.ts            promedio de servicio y simulación de puestos
    state.ts                 Session: estado leído + registro de lo que cambió + eventos
    grace.ts                 vencimiento y las cuatro políticas de ausencia
    entries.ts               join, leave, llamados, atender, ausente, cancelar, volver, liberar
    queues.ts                configuración, estado, archivo y carriles
    metrics.ts               ventana por día local y métricas
    notifications.ts         qué avisos corresponden (para λ notifier)
    views.ts                 TicketView y EntryView con la forma de la API Java
  src/persistence/
    keys.ts                  todas las claves de q-main en un archivo
    items.ts                 dominio ↔ ítems
    client.ts                cliente de documentos (DynamoDB Local si hay DYNAMODB_ENDPOINT)
    queue-store.ts           carga consistente, transacción con versión, reintentos
    directory-store.ts       establecimientos, membresías, avisos, límite por IP
  test/domain/               73 tests unitarios (vitest)
  test/integration/          21 tests contra DynamoDB Local (Testcontainers)
  vitest.config.ts           proyectos `unit` e `integration`
infra/terraform/tables.tf    + q-connections, con el mismo módulo externo
.github/workflows/terraform.yml  + `npm test` en el job build
```

### Cómo funciona una mutación

1. `QueueStore.mutate(queueId, operación)` lee la cola con lecturas fuertes: `META` y los carriles
   en un rango (`LANE#…` a `META`), y las entradas activas en dos consultas por prefijo (`A#`, `W#`).
2. La operación del dominio recibe una `Session`, modifica el estado en memoria y anota qué tocó y
   qué eventos produjo. No sabe nada de DynamoDB.
3. `commit` arma **una** transacción: `META` con `version = leída + 1` y la condición
   `version = leída`; cada entrada que cambió de estado se mueve (Delete del SK viejo, Put del
   nuevo, Update de su `ENTRY#/REF`); los carriles tocados; la fila del listado si cambió el nombre o
   el estado; y un ítem `QUEUE#…#EV` por evento.
4. Si la condición de `META` falla (u otra transacción tocaba los mismos ítems), se relee y se vuelve a
   correr la operación, con backoff exponencial y jitter, hasta 5 veces; después, `409
   CONCURRENT_MODIFICATION`.

### Decisiones que se apartan del documento

1. **Claves de fin por secuencia, claves del medio por punto medio.** Entrar al final usa la
   secuencia de la cola en base 62 con ancho fijo (8 caracteres + sufijo); solo `MOVE_BACK` usa el
   punto medio. Así las claves no crecen con la cantidad de joins: con el punto medio puro, cada
   entrada al final alarga la clave cada pocas inserciones, y mil joins darían claves de cientos de
   caracteres.
2. **`ENTRY#<id>/REF` además de `TICKET#`.** El staff opera por id de entrada, y una entrada
   terminada (para volver a ponerla en la fila) solo se encuentra si se conoce su SK actual. La
   referencia guarda el SK y se actualiza en la misma transacción cada vez que la entrada se mueve.
   `TICKET#` es inmutable.
3. **Sin `activeCount` en `META`** (ajuste 11 del ROADMAP).
4. **Lotes de 24 al cerrar una cola, no de 30** (ajuste 10). Lo detectó el test de integración: 30
   entradas escriben 121 ítems.
5. **El evento lleva la versión y un índice en el SK** (`<versión>#<índice>#<id>`), porque una sola
   transacción puede producir varios (vencer una gracia y llamar, por ejemplo) y tienen que quedar en
   orden.
6. **Qué avisos corresponden lo decide `notifications.ts` sobre el estado actual**, no la transacción
   del staff (§6.5): la Fase 5 solo tiene que llamarla.
7. **`DomainError` conserva los códigos de la API Java** (`QUEUE_FULL`, `INVALID_TRANSITION`, …), así
   el frontend no cambia su manejo de errores en la Fase 3.

### Verificado localmente

| Qué | Resultado |
|---|---|
| `npm run typecheck` | Sin errores (incluye los tests) |
| `npm run test:unit` | 73 tests: orden, selector, estimación, operaciones, las cuatro políticas, carriles, métricas por zona horaria, avisos |
| `npm run test:integration` | 21 tests contra DynamoDB Local 3.3.1: ciclo completo, mover SK y referencia, eventos en la transacción, vencimiento al leer, cierre en lotes, rechazo de transacciones de más de 100 ítems, membresías, deduplicación de avisos y límite por IP |
| Carreras de §6.1 | 5 tests (dos y tres llamados simultáneos, dos joins, último lugar, gracia contra staff). Una barrera fuerza que todos lean la misma versión antes de escribir. Corridos 4 veces seguidas sin fallas |
| `npm run build` | Sin cambios: el dominio todavía no lo usa ningún handler |
| Terraform `fmt`, `validate` y `tflint` | Sin errores (con las versiones del pipeline, en Docker) |

### Corregido en la revisión

1. **Dos `MOVE_BACK` al mismo lugar podían recibir la misma clave.** El punto medio es determinista,
   y un llamado conserva su clave mientras no está en la fila. Si alguien caía en el mismo lugar
   que un llamado que después volvía con "deshacer llamado", las dos entradas terminaban con el
   mismo SK y DynamoDB pisaba una con la otra. Ahora el punto medio esquiva las claves de todas las
   entradas activas, y además la persistencia exige `attribute_not_exists` al escribir el SK nuevo
   de una entrada que se movió, para que un error ahí falle en lugar de borrar a alguien. Hay un test
   que reproduce el caso y que falla sin el arreglo.
2. **Un aviso reservado podía quedar `PENDING` para siempre** si la Lambda moría entre reservarlo y
   enviarlo: el mismo defecto que tenía `retryFailed` en Java. Ahora un `PENDING` con más de
   `NOTIFICATION_LEASE_SECONDS` (120 s, más que el timeout del notifier) se puede retomar.
3. **Los tests no corren al destruir**: un test roto no puede impedir limpiar la cuenta del lab.

### Audit de flujos (después del push)

Revisión de todos los flujos de cliente y de staff buscando casos borde y cualquier cosa que pueda
costar plata o usuarios. Corregido, con tests:

| Problema | Riesgo | Arreglo |
|---|---|---|
| Sin límite de largo en nombre, email y teléfono, ni validación de formato | Cada mutación lee todas las entradas activas: nombres de cientos de KB harían que operar la cola cueste megabytes de lectura por acción | Nombre ≤ 120, email ≤ 254 con formato, teléfono con patrón, grupo de 1 a 50 |
| Sin `maxSize`, la cola no tenía techo | Lo mismo, sin cota | Techo absoluto de 1000 entradas activas, también para "traer de vuelta" |
| Configuración sin máximos ni enteros (una gracia de 10⁹ s, 1,5 puestos) | Rompe el cálculo del vencimiento (500) y armaría una cadena de mensajes SQS de años | Rango y entero para cada valor (gracia ≤ 3600 s, puestos ≤ 100, etc.) y para los carriles |
| Se podía desactivar un carril con gente esperando | En round robin, esa gente solo se llama cuando todos los otros carriles están vacíos: en un turno con movimiento, nunca | Igual que retirarlo: primero hay que vaciarlo |
| Cerrar la cola liberaba también a quien estaba en el mostrador | Le llegaba "la cola cerró" mientras lo atendían, y quedaba como abandono en las métricas | El cierre libera esperando y llamados; los que se atienden se terminan y se marcan atendidos |
| Idioma desconocido se guardaba tal cual | No hay plantilla de aviso para ese idioma | Cae en inglés |
| 5 reintentos ante conflicto | Una ráfaga de escaneos del QR podía devolver 409 a alguien que solo quería anotarse | 8 reintentos |
| Toda lectura era fuertemente consistente | El doble de costo en lo que más se consulta | `read(..., { consistent: false })` para la vista pública; mutaciones y ticket siguen fuertes |

Requisitos que el audit deja para las fases siguientes (anotados en el ROADMAP): IP desde
`sourceIp`, body en base64 por `binary_media_types`, autorización contra la cola leída, throttling
por método, reintento del frontend ante 409, y tope de reintentos en colas y stream.


### Revisión cruzada

Revisión de la fase por otro integrante, con los tests corridos en Node 22 (el del pipeline).
Corregido, cada uno con un test que falla sin el arreglo:

| Problema | Riesgo | Arreglo |
|---|---|---|
| `QueueStore.load` leía la configuración, los llamados y la fila en tres consultas en paralelo, y tres consultas no son una foto. Si otra transacción se confirmaba en el medio, alguien recién llamado podía no aparecer ni en la fila ni entre los llamados, y si la versión leída ya era la nueva, **el control de versión no lo detectaba** | Reproducido: en una cola llena (máximo 2), un join concurrente con un llamado entraba y la cola quedaba con 3 activas. Lo mismo vale para la capacidad de los carriles, el round robin y cualquier regla que cuente o recorra a todos | La configuración se lee primero, las entradas después, y al final se vuelve a leer la versión: si cambió, se relee todo (hasta 5 veces). Una lectura más por operación. Las lecturas eventualmente consistentes de la vista pública no lo necesitan: no deciden nada |
| `claimNotification` reservaba con un `Put` que reescribía el ítem entero | El contador `attempts` volvía a cero en cada reserva, y un aviso `FAILED` se podía reintentar sin tope: cada evento nuevo de la cola volvía a intentar un email que nunca iba a salir | Reserva con `Update`: cada reserva suma un intento (también cuenta el que murió sin informar), se conserva el `createdAt` original, y pasados `NOTIFICATION_MAX_ATTEMPTS` (5) deja de reservarse |
| `package.json` declaraba Node 20 | `testcontainers` 12.2 exige Node 22.22: con Node 20 los tests de integración caen con un error interno de `undici` | `engines` en `>=22.22` |

Queda para la Fase 3: si una transacción falla por una condición que no es la de la versión (por
ejemplo, el `attribute_not_exists` que protege los movimientos), `commit` relanza la excepción de
AWS tal cual. Los handlers tienen que traducirla a `409`, no dejar que salga como `500`.

### Sin verificar: necesita el lab

| Qué | Cómo se nota |
|---|---|
| Crear `q-connections` con `LabRole` | El `apply` falla con `AccessDenied` en DynamoDB |
| Que el job `build` corra Testcontainers en GitHub Actions | El paso "Tests de las funciones" falla al levantar el contenedor; el runner `ubuntu-latest` trae Docker, así que no debería |

### Falta para la Fase 3 (resuelto en la Fase 3)

- Los handlers `public` y `staff` sobre `QueueStore` y `DirectoryStore`, y sus rutas en API Gateway.
- La creación de colas desde la API (`QueueStore.create` + `newQueueState` ya existen).
- La traducción de `DomainError` a RFC 7807 en la respuesta HTTP.

---

## Fase 3 · API síncrona y Cognito

### Decisiones previas

| Decisión | Elegido |
|---|---|
| Confirmación de cuentas | **Automática**, con una Lambda de pre sign-up: el registro sigue siendo un solo paso y no depende del límite de 50 emails diarios de Cognito |
| Inicio de sesión | **USER_PASSWORD_AUTH con `fetch`**, sin SDK: la contraseña viaja por TLS a Cognito, como antes al backend Java |

### Qué se construyó

```
functions/src/
  http/api.ts                  pedido, respuestas RFC 7807 sin campos null, router por plantilla de ruta
  api/views.ts                 las vistas que faltaban, con la forma exacta de QueueViewFactory (Java)
  api/input.ts                 tipos de cada campo del body verificados antes de llegar al dominio
  api/users.ts                 los usuarios en Cognito, detrás de una interfaz (en memoria en los tests)
  handlers/public.ts           8 rutas: salud, cola, disponibilidad, QR, unirse, ticket, salir, avisos
  handlers/staff.ts            26 rutas: sesión, establecimientos, miembros, colas, carriles, entradas, métricas
  handlers/cognito-pre-signup.ts  confirma en el acto los registros propios
  handlers/seed.ts             datos de demo con las mismas operaciones del dominio
functions/test/integration/api.test.ts   10 tests de punta a punta con eventos de API Gateway
infra/terraform/
  auth.tf                      user pool, cliente web sin secreto, trigger y su permiso
  openapi.tf                   la API como tabla de rutas → documento OpenAPI 3
  api.tf                       API REST desde el documento, permisos, deployment, stage, throttling
  seed.tf · seed/demo.json     usuario de demo en Cognito y carga de datos por invocación de Lambda
  site.tf                      + config.json con los ids de Cognito
frontend/src/lib/
  config.ts                    lee config.json al cargar (o variables de entorno en desarrollo)
  cognito.ts                   registro e inicio de sesión contra Cognito, errores con los códigos de la API
  auth.tsx                     login y registro por Cognito; el registro crea el local con la API
  api.ts                       sin login propio; reintenta ante 409 CONCURRENT_MODIFICATION
```

### Decisiones que se apartan del roadmap

1. **La API se define con un documento OpenAPI, no con recursos sueltos.** Con 34 rutas, un recurso,
   un método, una integración y sus respuestas por ruta serían cientos de bloques casi iguales. Las
   rutas son una tabla en `openapi.tf` y el documento sale de ella con expresiones `for`: sumar un
   endpoint es sumar una línea. El deployment se rehace cuando cambia el hash del documento.
2. **Sin validación con JSON Schema en API Gateway.** Con `binary_media_types = ["*/*"]` (que hace
   falta para servir fuentes e imágenes desde S3), API Gateway trata también los JSON como binarios,
   y no está garantizado que valide un cuerpo binario: en el peor caso rechazaría todos los joins.
   La validación vive en `api/input.ts` y en el dominio, con respuestas RFC 7807 por campo.
3. **La ruta de salud la atiende `λ public`**, sin una función propia: se elimina `health` y la
   prueba de humo sigue teniendo a qué consultar.
4. **Los datos de demo se cargan invocando una Lambda (`aws_lambda_invocation`)**, no con
   `aws_dynamodb_table_item`. Escribir los ítems a mano duplicaría la forma de los datos (la cola
   tiene 25 campos, con versión y secuencias) y se desincronizaría del código. La función usa las
   mismas operaciones del dominio que la API y es idempotente.
5. **La Lambda del trigger de Cognito es un módulo aparte.** El user pool la referencia y la función
   del staff referencia al user pool: en el mismo `for_each`, eso es un ciclo.
6. **El SSE queda apagado en los builds desplegados** (`NEXT_PUBLIC_STREAMS`) hasta la Fase 5: las
   rutas de stream no existen, y el del staff pondría el token de Cognito en la URL. Las pantallas
   se mantienen al día con el polling de respaldo que ya tenía `useLiveResource`.
7. **El token que usa la API es el ID token de Cognito**, que es el que valida el authorizer sin
   configurar scopes de OAuth. Dura `session_hours` (12 por defecto), como el token de la versión Java.
8. **El código `OWNER_REQUIRED` pasa a ser `OWNER_ONLY`**, el de la API Java y el que traduce el
   frontend.
9. **El listado de miembros guarda el email y el nombre en la membresía**, así se lee sin una llamada
   a Cognito por cada persona.

### Problemas encontrados y resueltos

| Problema | Cómo se notó | Arreglo |
|---|---|---|
| La librería del QR es CommonJS y pide `zlib`, `fs` y `stream` con `require`; en un bundle ESM, esbuild lo reemplaza por un `require` que falla en ejecución | Bundle de prueba: `Dynamic require of "fs" is not supported` | Un banner en `build.mjs` que crea `require` con `createRequire` |
| Un `*/` dentro de un comentario de bloque en un test cortaba el comentario | Error de parseo | Comentario de línea |
| Si una transacción cae por una condición que no es la versión, el error de AWS salía como 500 | Revisión de la Fase 2 | El router lo responde como `409 CONCURRENT_MODIFICATION` |

### Verificado localmente

| Qué | Resultado |
|---|---|
| `functions`: typecheck y los 104 tests | En verde. Los 10 nuevos recorren la API de punta a punta: crear local y cola, unirse con el body en base64, tablero, llamar, ticket, atender, historial, métricas, salir, autorización por la cola leída, validación de tipos y banderas `clear*`, carriles y disponibilidad, límite por IP, QR, 404 con código estable, 401 sin claims y datos de demo idempotentes |
| Los bundles, no el código fuente, contra DynamoDB Local | La carga de demo desde `demo.json`, la página de ingreso con los dos carriles, un grupo de 4 que cae en "3 o más", el QR como PNG y la salud |
| Frontend: typecheck y build con `/prod` | En verde |
| Terraform `fmt`, `validate` y `tflint` | Sin errores ni advertencias |
| El documento OpenAPI evaluado con `terraform console` | 25 rutas de la API más las 2 del sitio, parámetros de path, authorizer solo en las del staff, errores de API Gateway en RFC 7807 |
| `actionlint` | Sin errores. La prueba de humo ahora también se une a la cola de demo, ve su ticket y se va |

### Sin verificar: necesita el lab

| Riesgo | Cómo se nota | Plan B |
|---|---|---|
| Cognito no puede invocar el trigger con el permiso que da Terraform | El registro o el usuario de demo fallan con `AccessDeniedException` del trigger | Quitar el trigger y confirmar con `AdminConfirmSignUp` desde la API |
| API Gateway rechaza algo del documento OpenAPI | El `apply` de `aws_api_gateway_rest_api` falla con el detalle del import | Ajustar el documento: el error dice qué ruta |
| `method_settings` no acepta la ruta con `{queueId}` | El `apply` del throttling por ruta falla | Dejar solo el techo general `*/*` |
| `LabRole` no tiene permisos de administración de Cognito | `/auth/me` o el alta de miembros responden 500 | `/auth/me` ya cae en los claims del token si Cognito no responde nada |

### Para probar después del apply

1. `terraform output -raw site_url` abre el sitio.
2. `terraform output -raw demo_queue_url` es la cola de demo, como la ve un cliente.
3. Entrar al panel con `terraform output -raw demo_staff_email` y
   `terraform output -raw demo_staff_password`.


### Rúbrica: lo que suma esta fase

| Criterio | Dónde |
|---|---|
| Módulos propios | `lambda-function` pasa a usarse 4 veces: el `for_each` de `functions.tf` (public, staff, seed) y `module.pre_signup` (`auth.tf`) |
| `for_each` | Permisos de API Gateway por función y techos de throttling por ruta (`api.tf`) |
| `count` | Usuario de demo, su contraseña y la carga de datos, según `var.cargar_demo` (`seed.tf`) |
| `depends_on` | El usuario de demo espera al permiso del trigger: crearlo invoca la Lambda, y nada lo referencia (`seed.tf`) |
| `lifecycle` | `create_before_destroy` en el deployment, que ahora se rehace con el hash del documento OpenAPI |
| Funciones | `jsondecode`, `file`, `regexall`, `distinct`, `split`, `lower`, `replace`, `trimprefix`, `tostring`, `try`, además de las de la Fase 1 |
| Locals | La tabla de rutas y el documento OpenAPI armado a partir de ella (`openapi.tf`), los datos de demo |

---

## Fase 4 · Bus de eventos

### Qué se construyó

```
infra/terraform/
  modules/queue-with-dlq/      tercer módulo propio: cola, DLQ, redrive, permiso de SNS y alarmas
  events.tf                    SNS FIFO, las tres colas, suscripciones, cola de fallas del stream y su mapeo
  monitoring.tf                SNS q-alerts y la suscripción por email opcional
  locals.tf                    + las colas (una por consumidor) y los tipos que filtra q-notifications
functions/src/handlers/stream-publisher.ts   reparte los eventos del stream
functions/test/handlers/stream-publisher.test.ts   4 tests unitarios con SNS y SQS falsos
functions/test/integration/stream.test.ts         el stream real de DynamoDB Local
```

```
q-main ──Streams──▶ λ stream-publisher ──▶ SNS FIFO q-queue-events ──┬─▶ SQS FIFO q-push
                           │                                         └─▶ SQS q-notifications (filtrada)
                           └──────────────────────────────────────────▶ SQS q-lifecycle (con demora)
```

| Pieza | Configuración |
|---|---|
| Mapeo del stream | Lotes de 100, una ejecución por shard, respuesta parcial por registro, partir el lote ante error, 5 reintentos, edad máxima de 1 h y, al agotarse, la cola `q-stream-failures` con su alarma |
| Filtro del mapeo | Solo `INSERT` de ítems con `kind = EVENT`: entradas, colas, avisos y límites por IP no invocan la función |
| `q-queue-events` | FIFO, grupo = cola, deduplicación = id del evento |
| `q-push` | FIFO, sin filtro. Visibilidad 180 s |
| `q-notifications` | Standard, filtrada a los eventos que pueden mover a alguien o cambiar su espera. Visibilidad 180 s |
| `q-lifecycle` | Standard, le escribe directo `stream-publisher`: `GRACE` con demora hasta el vencimiento (tope de 900 s) por cada llamado, `RELEASE` sin demora por cada cierre. Visibilidad 360 s |
| Las tres | DLQ propia, 5 intentos, alarma con el primer mensaje en la DLQ |

### Decisiones que se apartan del roadmap

1. **El filtro del stream mira `kind = EVENT`, no el sufijo `#EV` de la clave.** Los filtros de los
   mapeos de Lambda tienen comparación exacta y por prefijo, pero no por sufijo garantizado. Todo
   ítem de evento ya lleva `kind = EVENT`. La función además vuelve a verificarlo, así un filtro mal
   escrito no puede publicar otra cosa.
2. **`MaximumConcurrency` pasa a la Fase 5.** Es una propiedad del mapeo de cada consumidor, y los
   consumidores se crean ahí. El stream ya usa una sola ejecución por shard.
3. **La alarma de atraso de `q-push` se enciende en la Fase 5.** Sin consumidor, sonaría con el
   primer evento. El módulo ya la soporta con `max_message_age_seconds`.
4. **La cola de fallas del stream no usa el módulo:** es el destino final de lo que no se pudo
   publicar, y una DLQ de una DLQ no tiene sentido. Tiene su propia alarma.
5. **Los eventos se ordenan por cola y versión antes de publicar.** DynamoDB garantiza el orden del
   stream por ítem, no entre ítems distintos. Si un evento falla, se informa el primer registro
   pendiente en el orden del stream; lo que se vuelva a publicar lo descarta la deduplicación de SNS.

### Problemas encontrados y resueltos

| Problema | Cómo se notó | Arreglo |
|---|---|---|
| `@aws-sdk/util-dynamodb` no se publica con la misma versión que los clientes | `npm install` falló con `ETARGET` | Fijada en la versión que ya usa `lib-dynamodb` (3.996.9) |
| El cliente de Streams del SDK deserializa un mapa vacío como `{}`, que `unmarshall` rechaza | El test del stream real falló con `No value defined` | Solo afecta al test: Lambda entrega el JSON del servicio, con su `M`. El test lo restaura así |

### Verificado localmente

| Qué | Resultado |
|---|---|
| 109 tests | En verde. Unitarios: qué se publica y qué no, grupo y deduplicación, demora de la gracia con su tope, cierre sin demora, orden por cola y versión, y qué registro se informa cuando algo falla. Integración: unirse y llamar en DynamoDB Local, leer su stream como lo haría el mapeo, y ver salir `QUEUE_CREATED`, `ENTRY_JOINED` y `ENTRY_CALLED`, más un `GRACE` con 90 s de demora |
| El bundle de `stream-publisher` | Carga, interpreta un registro y, con SNS caído, devuelve su número de secuencia para reintentar |
| Terraform `fmt`, `validate`, `tflint`; `actionlint` | Sin errores |

### Sin verificar: necesita el lab

| Riesgo | Cómo se nota | Plan B |
|---|---|---|
| Un tópico SNS FIFO no puede entregar a una cola standard (`q-notifications`) | El `apply` de la suscripción falla | `q-notifications` también FIFO (`fifo = true` en `locals.tf`) |
| `LabRole` no puede leer el stream o escribir en la cola de fallas | El mapeo queda en estado de error | Revisar el estado con `aws lambda get-event-source-mapping` |
| El filtro del mapeo no coincide con la forma real del registro | La función nunca se invoca y las colas quedan vacías | Sacar el filtro: la función ya descarta lo que no es un evento |

### Cómo comprobarlo en el lab

Después de unirse a la cola de demo y llamar a alguien desde el panel, las tres colas tienen que
tener mensajes (todavía no hay consumidores):

```bash
for q in q-push.fifo q-notifications q-lifecycle; do
  url=$(aws sqs get-queue-url --queue-name "$q" --query QueueUrl --output text)
  aws sqs get-queue-attributes --queue-url "$url" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesDelayed \
    --query "Attributes" --output text | sed "s|^|$q |"
done
```

`q-lifecycle` muestra el vencimiento de la gracia como mensaje demorado. Para ver la DLQ y la
alarma: recibir el mismo mensaje de `q-notifications` seis veces sin borrarlo
(`aws sqs receive-message --queue-url … --visibility-timeout 0`), y a la sexta pasa a
`q-notifications-dlq` y la alarma `q-notifications-dlq-con-mensajes` se dispara.

### Rúbrica: lo que suma esta fase

| Criterio | Dónde |
|---|---|
| Módulos propios | Tercer módulo: `queue-with-dlq`, usado tres veces con `for_each` (`events.tf`) |
| `for_each` | Las colas y sus suscripciones a SNS, filtradas con una expresión `for … if` |
| `count` | Dentro del módulo: la política de la cola solo si hay publicadores, la alarma de atraso solo si se pide; la suscripción por email a las alertas |
| Funciones | `jsonencode` en la política de redrive, los filtros y el patrón del mapeo |

---

## Fase 5 · Consumidores y tiempo real

### Qué se construyó

```
functions/src/
  handlers/ws-connections.ts   $connect y $disconnect: ticket del cliente o ticket de un solo uso del staff
  handlers/broadcaster.ts      consume q-push: tablero para el staff, ticket para cada cliente
  handlers/notifier.ts         consume q-notifications: avisos por SES, una vez cada uno, en el idioma del cliente
  handlers/lifecycle.ts        consume q-lifecycle: gracia vencida (o reprogramada) y cierre en lotes
  notifications/templates.ts   los textos de i18n/notifications*.properties, en inglés y español
  persistence/connections-store.ts   las conexiones en q-connections, por el índice byQueue
  consumers/sqs.ts             respuesta parcial por mensaje, común a los tres consumidores
  handlers/staff.ts            + POST /queues/{queueId}/ws-tickets
infra/terraform/
  realtime.tf                  API WebSocket: rutas, integración mock del ping, deployment y stage
  notifications.tf             SES: el remitente y las direcciones del grupo para el sandbox
  functions.tf                 funciones en dos grupos y un mapeo por consumidor con su techo de concurrencia
frontend/src/lib/useLiveResource.ts   WebSocket con reconexión, ping y recarga por REST al reconectar
.github/scripts/smoke-realtime.mjs    la cadena completa del tiempo real, en la prueba de humo
```

### Decisiones que se apartan del roadmap

1. **Sin ruta `subscribe`.** La cola de una conexión ya se sabe al abrirla: la del ticket del cliente
   o la que fija el ticket de un solo uso del staff, que se emite para una cola concreta
   (`POST /queues/{queueId}/ws-tickets`). Cada conexión cuesta una invocación al abrir y otra al
   cerrar, en lugar de tres. Con la concurrencia del lab, importa.
2. **Las funciones se dividen en dos `for_each`**: las que atiende la API REST y los *workers*.
   El broadcaster y el notifier necesitan la URL del sitio, y la API REST depende de sus propias
   funciones: en un solo mapa, todo dependería de todo. Las URLs se arman con el id de cada API y no
   con su stage, que depende del deployment y este de las funciones. Se comprobó con
   `terraform graph -type=plan` que no queda ningún ciclo.
3. **Los timeouts de los consumidores viven en un mapa propio (`local.consumers`)**, del que salen
   tanto la función como la visibilidad de su cola (seis veces el timeout). Si la visibilidad se
   leyera del mapa de funciones, que depende de las colas, habría otro ciclo.
4. **Un tablero que no entra en un mensaje de WebSocket (128 KB) se reemplaza por `queue.changed`**,
   y el navegador lo pide por REST. Pasa con colas de cientos de personas.
5. **Un push que falla no se reintenta**, salvo que falle la lectura de la cola: el cliente detecta
   el corte, reconecta y relee por REST. Una conexión que ya no existe (`410 Gone`) se borra.
6. **Un rechazo del sandbox de SES por un destinatario no verificado se registra como envío
   simulado y se marca enviado**, para que no se reintente; lo mismo si no hay remitente
   configurado. Cualquier otro error de SES deja el aviso `FAILED` y el mensaje vuelve a la cola.
7. **La gracia de más de 15 minutos se programa por tramos**, y un mensaje que llega un instante
   antes de tiempo se reprograma por lo que falta.

### Problemas encontrados y resueltos

| Problema | Cómo se notó | Arreglo |
|---|---|---|
| `coalesce(var.ses_sender_email, "")` falla con el valor por defecto: `coalesce` no acepta strings vacíos | tflint, al evaluar los locals | Una condicional |
| Un ciclo de dependencias entre la API REST, sus funciones y las que necesitan su URL | Análisis previo, confirmado con `terraform graph` | Dos grupos de funciones (decisión 2) |

### Verificado localmente

| Qué | Resultado |
|---|---|
| 116 tests | En verde. Los 7 nuevos, más la ruta del ticket en un test existente: el cliente y el staff conectan, un ticket inválido o vencido se rechaza, el de un solo uso no sirve dos veces, `$disconnect` borra; el broadcaster le da al staff el tablero y a cada cliente solo su ticket, y borra las conexiones que ya no existen; un tablero enorme se reemplaza por `queue.changed`; el notifier manda cada aviso una vez y en el idioma del cliente, aunque el mismo evento llegue dos veces; SES simula ante el sandbox y falla ante otro error; lifecycle reprograma la gracia si llega antes y la vence después; cerrar una cola de 30 personas la vacía en dos lotes; y solo un miembro obtiene el ticket del WebSocket |
| Los 9 bundles | Todos cargan |
| Frontend, Terraform (`fmt`, `validate`, `tflint`, `graph`), `actionlint` | Sin errores |

### Sin verificar: necesita el lab

| Riesgo | Cómo se nota | Plan B |
|---|---|---|
| La integración mock del `ping` no se acepta así | El `apply` de la integración falla | Rutear `ping` a `ws-connections` y responder 200 sin hacer nada |
| `LabRole` no puede escribir en las conexiones (`execute-api:ManageConnections`) | El broadcaster loguea errores de permisos y las pantallas viven del polling | Sin plan B de infraestructura: el polling ya mantiene todo funcionando |
| SES no está habilitado | El `apply` de las identidades falla | Dejar `ses_sender_email` en null: los avisos quedan simulados en los logs |

### Cómo probarlo

- **La prueba de humo del pipeline ya recorre la cadena completa del tiempo real en AWS:** abre un
  WebSocket con el ticket de un cliente de prueba, deja la cola por REST y espera que el aviso
  llegue por el push en menos de 45 segundos.
- **Emails reales:** `ses_sender_email` y `ses_verified_recipients` con direcciones del grupo. Cada
  dirección recibe un email de AWS para verificarla; después, quien se una con una de esas
  direcciones recibe los avisos de verdad. Sin eso, aparecen en los logs de `q-notifier`.
- **La gracia sin nadie mirando:** llamar a alguien desde el panel, cerrar el navegador y, pasada la
  gracia, ver que la entrada volvió a la fila (o salió, según la política) sin que nadie la toque.

### Rúbrica: lo que suma esta fase

| Criterio | Dónde |
|---|---|
| Módulos propios | `lambda-function` en dos `for_each` (API y workers) más el trigger de Cognito: 9 funciones |
| `for_each` | Los mapeos de cada consumidor, las rutas `$connect` y `$disconnect`, las direcciones verificadas de SES |
| `count` | El remitente de SES, solo si se configura |
| `depends_on` | El deployment de la API WebSocket espera a sus rutas: falla si la API no tiene ninguna, y no las referencia |
| `lifecycle` | `create_before_destroy` en el deployment de la API WebSocket |
| Funciones | `alltrue` en la validación de las direcciones, `toset`, `lower`, `format` en las URLs armadas con el id de cada API |


## Auditoría previa a la primera prueba en el lab

Revisión de punta a punta antes de desplegar: Terraform contra las restricciones del Learner Lab,
seguridad y consistencia de las Lambdas, frontend servido bajo `/prod` y pipeline. No apareció nada
que bloquee el `apply`. Cada hallazgo se verificó antes de corregirlo.

### Corregido

| Hallazgo | Qué pasaba | Arreglo |
|---|---|---|
| Cola trabada por el límite de 100 ítems | Toda operación vencía a *todos* los llamados vencidos en una transacción (4 ítems cada uno). Con 25 o más, la cola daba 500 para siempre, también en lifecycle | `expireDue` vence a lo sumo 15 por sesión, los más viejos primero, y `read()` repite hasta 5 rondas. Test de regresión: sin el arreglo falla con `RangeError: 125 ítems` |
| Alta de miembros usurpable | Si el mail ya tenía cuenta, el alta ignoraba la contraseña y agregaba a quien la había registrado (incluso como OWNER) | Con contraseña y cuenta existente responde 409 `EMAIL_TAKEN`. Si Cognito rechaza la contraseña, se borra la cuenta a medio crear (antes quedaba huérfana y el reintento la agregaba sin contraseña) |
| Botón "volver a la fila" sin `/prod` | Era un `<a>` plano: llevaba a `/q/?id=…` sin stage y API Gateway respondía 403 | `ButtonLink` (Next aplica el basePath) |
| Pipeline trabado por la aprobación | La concurrency estaba en el workflow: un apply esperando aprobación frenaba validate y plan del push siguiente, y un label cualquiera cancelaba el run pendiente | Concurrency solo en los jobs `apply` y `destroy`. Plan, apply y destroy esperan el lock de S3 con `-lock-timeout=10m` |
| Avisos simulados como enviados | En el sandbox de SES, un aviso que no salió quedaba `SENT` por `EMAIL` | Queda `SENT` por `LOG` |
| Broadcaster | Un mensaje ilegible tiraba el lote entero | Se descarta ese mensaje y el resto sigue |
| SES | Remitente repetido en `ses_verified_recipients` con otras mayúsculas creaba dos identidades iguales | Se compara en minúsculas |
| 404 del sitio | Una ruta inexistente devolvía el XML de error de S3 | El 4xx de S3 se pasa a texto (`CONVERT_TO_TEXT`) y una plantilla devuelve `404.html` del build con status 404, dentro de un bloque literal `#[[ ]]#` para que Velocity no toque `$` ni `#`. Probado con Velocity 1.7: sale idéntica. El smoke test lo comprueba en el lab |
| Historial del panel | Faltaban `QUEUE_CLOSED` y `LANE_CHANGED`: se veía la clave cruda | Tipos y textos en los dos idiomas |

### Pendiente, a decidir

- ~~**Concurrencia de Lambda en 10.** Los consumidores pueden tomar 6 y a la API le quedan 2-3. El
  stage acepta 50 rps con ráfaga de 100: ante un pico Lambda limita y responde 5xx en vez de 429.~~
  Resuelto en el audit de funcionamiento y despliegue: la API baja a 25/50 por ruta y el sitio, que
  no usa Lambdas, sube a 500/1000.
- **Sesión del staff sin refresh.** El refresh token se descarta: la sesión muere a las 12 h.
- ~~**`destroy` necesita compilar.** Depende del build, así que un error de TypeScript impide
  limpiar la cuenta.~~ Resuelto en el audit de funcionamiento y despliegue.
- **`partySize` sin límite común.** Availability acepta 80 y el join corta en 50; `requirePartySize`
  se guarda pero no se aplica.
- **Para mirar en el lab:**
  - si los tres `method_settings` chocan al aplicarse en paralelo (se resuelve reaplicando);
  - si un `plan` posterior al apply sale vacío;
  - si `curl -i <site_url>no-existe/` sin `Accept: text/html` también devuelve la página: la
    plantilla se elige por el Accept, y `*/*` debería caer en la de `application/json`;
  - si la trust policy de LabRole incluye `apigateway.amazonaws.com`, que la integración del sitio
    con S3 necesita.

### Verificado localmente

117 tests (unit + integración), typecheck de functions y frontend, build del frontend con `/prod`,
`terraform fmt`/`validate`, tflint y actionlint.

---

## Audit de funcionamiento y despliegue (Fases 1 a 5)

Revisión del código de las cinco fases y del despliegue, buscando lo que pueda costar usuarios o
plata en el lab o en la demo. Corregido:

| Hallazgo | Qué pasaba | Arreglo |
|---|---|---|
| El sitio compartía el throttling con la API | Un solo techo de 50 rps para todo: veinte personas escaneando el mismo QR piden cientos de archivos a la vez y recibían 429, con la página cargando rota. Y al revés, 50 rps por ruta era más de lo que la concurrencia de Lambda del lab puede atender | `*/*` (la API) en 25/50; los archivos del sitio (`{proxy+}/GET`), que no usan Lambdas, en 500/1000; unirse y salir siguen en 10/20. Son 4 method settings, no uno por ruta, para no multiplicar las modificaciones del stage en paralelo |
| 20 joins por IP por minuto | Un local o un aula salen a internet por un único NAT: con una sala entera escaneando el QR, el join número 21 recibía 429 | 60 por minuto, documentado en la variable |
| Historial de una entrada | `GET /entries/{id}/events` leía todos los eventos de la cola de los últimos 30 días y filtraba en memoria: en una cola con movimiento, decenas de MB por consulta y riesgo de timeout | `eventsSince`: recorre los eventos hacia atrás y corta en el primero anterior a la hora en que esa persona se unió. Test de integración |
| `destroy` dependía del build | Un error de TypeScript o del frontend impedía limpiar la cuenta, y todo seguía desplegado y gastando | El job `destroy` ya no necesita `build`: genera un bundle vacío por función (alcanza para que `archive_file` evalúe) y, sin el sitio, `fileset` queda vacío. El job `build` no corre al destruir |

Para mirar, sin corregir:

| Tema | Riesgo | Sugerencia |
|---|---|---|
| Conexiones WebSocket por ticket | Con un mismo ticket se pueden abrir conexiones sin límite, y cada movimiento de la cola le empuja a todas | Limitar las conexiones por ticket en `$connect` si aparece abuso |
| Registro sin verificar el email | El pre sign-up confirma la cuenta sin probar que el email es de quien se registra. Un dueño que agrega a un miembro "sin contraseña" por email puede estar sumando a quien registró ese email antes | Aceptable con el sandbox de SES; en producción, verificar el email |
| Cierre de una cola grande | El notifier manda un aviso `QUEUE_CLOSED` por persona; SES tiene un ritmo máximo de envío y los que superen los reintentos quedan en la DLQ | Aceptable en el lab (solo direcciones verificadas) |
| Decisiones de producto del audit anterior | Contacto repetido en la misma cola, ausencias infinitas con `KEEP_POSITION`, reabrir a mitad de una liberación | Siguen abiertas |

Verificado: 118 tests, typecheck, `terraform fmt`/`validate` (también con los bundles vacíos del
job `destroy`), tflint y actionlint. **Nada de las Fases 1 a 5 corrió todavía en el lab.**

---

## Revisión de las fases 1 a 5

Revisión hecha con el código local contra todo lo que se puede verificar sin el lab: `fmt`,
`validate`, tflint, actionlint, typecheck, los tests, y una comparación entre las rutas de
`openapi.tf` y las de los handlers (8 públicas y 27 de staff, coinciden exactamente y ninguna de
staff queda sin authorizer). Corregido:

| Hallazgo | Qué pasaba | Arreglo |
|---|---|---|
| Volver a la fila salteaba la regla de los carriles | La regla que impide apagar o retirar un carril con gente solo cuenta a los activos. Quien ya había terminado no lo es, así que su carril se podía apagar mientras estaba afuera, y `requeue` lo devolvía a ese carril sin mirarlo: apagado, el round robin no lo visita; retirado, no aparece en ninguna tarjeta del tablero aunque cuente en "Esperando". Solo se llegaba por la API: el botón de la interfaz actúa sobre llamados o en atención | Traer de vuelta a alguien que había terminado es un ingreso nuevo, con los controles de `join` y en su orden: su carril si todavía acepta su tamaño, si no el que lo acepte hoy (o `NO_COMPATIBLE_LANE`); después el tope de ese carril (`LANE_FULL`) y el de la cola. El evento registra el cambio de carril. 10 tests, dos fijando cuál error gana si fallan dos controles |
| Filas del tablero de distinta altura en escritorio | La celda de la espera usaba `sm:block`, que mira la ventana. En una columna de ~450 px a 1400 px de ventana aparecía igual, y "Sin espera" mandaba los botones a una segunda línea y "25 min" no: filas de 106 o 78 px según el texto | Consulta de contenedor: la lista es `@container` y la celda `@lg:block`. 62 px todas a 1400 px; oculta y sin desborde a 375 px |
| `app.env` sin ignorar | El archivo del despliegue manual del TP2, con la contraseña de RDS y el app password de Gmail en texto plano, estaba en el árbol de trabajo a un `git add .` del repositorio público | `app.env` y `frontend/web.zip` en `.gitignore` |

**Decidido, sin cambios:** se mantiene que no se puede apagar ni retirar un carril con gente activa,
con ninguna estrategia. Volver a la fila no la debilita: quien había terminado ya no estaba en el
carril, y lo que se hace ahora es readmitirlo con los mismos controles que a cualquiera que llega.

Para mirar, sin corregir:

| Tema | Qué se sabe |
|---|---|
| `races.test.ts`, "tres a la vez" | Falló 1 vez en ~29 corridas de la suite completa y no se pudo reproducir. **No es un error del control optimista**: el ítem `META` va con `version = :read` dentro de la misma transacción, así que dos escrituras sobre la misma versión no pueden confirmarse las dos. Tampoco es el timeout (60 s) ni agotar los 10 intentos (falló en 197 ms, una ronda). Si vuelve a pasar en el pipeline, la causa queda en la salida del test: DynamoDB pone los motivos en el propio mensaje del error (`Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]`, comprobado contra DynamoDB Local) |
| `reasons[0]` en `commit` | Solo reconoce `ConditionalCheckFailed` en la posición 0. Una condición fallida en otra posición sale de `commit` sin traducir; en la API, `api.ts` la registra y responde 409, no 500. No conviene pasarlo a `reasons.some(...)`: convertiría en reintento la condición del SK que protege contra claves de orden repetidas |
| Alarmas de CloudWatch | `queue-with-dlq` crea dos por cola. Si el SCP del lab niega `cloudwatch:PutMetricAlarm`, el `apply` falla en los recursos de la fase 4 |

Verificado: 128 tests (5 corridas seguidas sin fallas), typecheck de functions y frontend, build del
frontend, bundles de las funciones, `terraform fmt`/`validate`, tflint y actionlint.

---

## Primera corrida en el lab

PR #1 (`entrega-3 → main`, borrador, no se mergea) en `josebl123/tp-cloud`, ejecución
[39079525048](https://github.com/josebl123/tp-cloud/actions/runs/39079525048).

**Validar y Compilar pasaron**: los 128 tests, incluida la suite de integración contra DynamoDB
Local, corrieron en verde en un runner limpio de GitHub. **El plan pasó**: 203 recursos a crear,
ninguno a cambiar ni destruir.

**El apply falló** al crear el primer bucket:

```
Error: reading S3 Bucket (q-logs-<cuenta>-us-east-1) object lock configuration: ...
AccessDenied: ... not authorized to perform: s3:GetBucketObjectLockConfiguration ...
with an explicit deny in a service control policy: ...service_control_policy/p-tbyuw8u2
```

El provider, después de crear un bucket con `aws_s3_bucket`, lee su configuración de object lock, y
el SCP del Learner Lab lo niega. **Ninguna versión del provider lo evita**: en v4.67, v5.100 y v6.67
un `AccessDenied` en esa lectura es un error en la partición `aws` (solo toleran "no encontrado" y
"no implementado"), y la lectura es incondicional. Mientras el SCP siga así, `aws_s3_bucket` no se
puede usar en esta cuenta.

| | |
|---|---|
| Creado antes de la falla | Las dos tablas de DynamoDB, las 7 colas SQS, los 2 tópicos SNS, **las 5 alarmas de CloudWatch**, la API WebSocket con su ruta e integración `ping`, un log group, la contraseña de demo. El bucket `q-logs` existe pero quedó *tainted* en el estado |
| Respondido | **Las alarmas de CloudWatch están permitidas** (era uno de los riesgos anotados) |
| Sin probar todavía | Que API Gateway pueda asumir `LabRole` para leer el sitio: el apply no llegó |
| `destroy` | **También falla hoy**: refresca el estado antes de destruir, y refrescar el bucket hace la misma lectura negada. Salida: `terraform destroy -refresh=false`, que el workflow todavía no pasa. Lo desplegado cuesta casi nada mientras tanto |

### Qué lecturas de S3 niega el SCP

Probado desde CloudShell contra el bucket `q-logs` que quedó creado, con las 16 lecturas de bucket:
**solo `get-object-lock-configuration` está negada.** Versionado, registros de acceso, política,
bloqueo de acceso público, propiedad, ciclo de vida, ubicación, ACL, CORS, sitio web, aceleración,
pago por pedido, cifrado, replicación y tags responden.

### Decisión: el pipeline crea los buckets, Terraform los configura

| | |
|---|---|
| `scripts/buckets.sh` | `create` anota los nombres en el bucket del estado (`queue/buckets.txt`) y después crea los que falten. `delete` vacía cada uno (todas las versiones y marcas de borrado) y lo borra, en el orden anotado, con reintentos para los registros de acceso que S3 entrega con atraso |
| Job `apply` | Paso nuevo antes del apply: lee los nombres del output `bucket_names` **del plan guardado** y llama a `create`. Terraform sigue siendo la única fuente de los nombres |
| Output `bucket_names` | Sale de `local.bucket_names` y no de los módulos, para que se conozca en el plan |
| Módulo `private-bucket` | Ya no tiene `aws_s3_bucket`: recibe el nombre de un bucket existente y administra todo lo demás. Sin `force_destroy` ni `tags`, que eran atributos de ese recurso. El ARN sale de `data "aws_partition"` |
| Job `destroy` | `-refresh=false`, y después `delete`. Se anotan los nombres antes de crear, así `destroy` los encuentra aunque un apply se corte entre crear los buckets y escribir sus outputs |

Probado en local: `fmt`, `validate`, tflint y shellcheck limpios, y `buckets.sh` ejercitado contra un
S3 simulado (borrar sin nada anotado, crear, crear de nuevo sin efecto, vaciar de a páginas y borrar
en orden, y fallar si el plan no trae nombres).

### Cómo salir del estado de la primera corrida

El estado tiene el `aws_s3_bucket` de `q-logs` marcado como *tainted*, y ese recurso ya no está en la
configuración. **Cualquier `plan` falla mientras siga ahí**: lo refresca, y refrescarlo es la lectura
negada. Por eso el primer paso es destruir:

1. Push del cambio. El `plan` de ese push falla por eso; es lo esperado.
2. Etiqueta `destroy` en el PR y aprobar `aws-lab`. Con `-refresh=false` borra todo lo de la primera
   corrida, incluido `q-logs` (el provider lo borra sin leer su object lock). No hay buckets anotados
   todavía, así que el paso de borrarlos no hace nada.
3. Quitar la etiqueta y volver a correr el workflow del último push: el plan parte de un estado vacío.
4. Aprobar el `apply`.

### Resultado

La salida funcionó tal cual: el `destroy` con `-refresh=false` borró los 29 recursos de la primera
corrida, incluido `q-logs` (el provider lo borra con `DeleteBucket` y comprueba con `HeadBucket`, sin
leer el object lock), y el paso de los buckets no encontró nada anotado. El plan siguiente partió de
un estado vacío.

**El apply pasó entero**, en la ejecución
[39081506431](https://github.com/josebl123/tp-cloud/actions/runs/39081506431) (intento 2): el paso
de los buckets anotó y creó los tres, Terraform agregó **200 recursos** (los 203 del plan original
menos los tres `aws_s3_bucket`) y **la prueba de humo pasó completa**, incluido el recorrido del
cliente en la cola de demo y el tiempo real por WebSocket.

Comprobado además desde afuera, solo lectura:

| | |
|---|---|
| El sitio, servido por API Gateway desde S3 con `LabRole` | 200, HTML. **El último riesgo del lab queda respondido**: API Gateway puede asumir `LabRole` |
| Fuentes y JS (binarios) | 200, `font/woff2` sin corromper |
| Una ruta que no existe | 404 con la página del sitio, no el XML de S3 |
| `config.json` | Con el user pool, el cliente y la URL `wss://` |
| `/api/v1/health` | 200: la Lambda escribe y lee `q-main` |
| La cola de demo por la API pública | `Mesas`, abierta, con sus dos carriles |
| La API del staff sin token | 401: el authorizer de Cognito la protege |

Los tres riesgos que se anotaron antes de ir al lab: **las alarmas de CloudWatch están permitidas**,
**API Gateway puede asumir `LabRole`**, y con la concurrencia de la cuenta no apareció ninguna
limitación (los consumidores y la API respondieron en la prueba de humo; no se midió bajo carga).

**Cada push a `entrega-3` dispara un plan y deja un apply esperando aprobación**, y ese plan nunca
sale vacío. **Corregido:** acá decía que un cambio que no toca la infraestructura planea sin cambios,
y no es así. El push de este registro, que solo tocó documentación, planeó 5 a crear, 75 a cambiar y 5
a destruir (ejecución 39082539689): el build ID de Next es aleatorio, así que cada build cambia los
objetos del sitio, y la página 404 que va adentro de la definición de la API REST, que por eso
reemplaza su deployment; el deployment de la API WebSocket también se reemplazó, sin que se sepa
todavía por qué. Ese apply se puede dejar sin aprobar, pero **un apply pendiente retiene el grupo de
concurrencia y bloquea el destroy**: hay que cancelarlo antes de destruir. Fijar el build ID
(`generateBuildId`) queda como mejora.

---

## Fase 6 · Retirar lo anterior

Antes de empezar, el despliegue del lab se destruyó desde el pipeline (ejecución
[39083049121](https://github.com/josebl123/tp-cloud/actions/runs/39083049121)): 200 recursos
destruidos, y los tres buckets vaciados y borrados por `buckets.sh delete`.

### Qué se hizo

| | |
|---|---|
| `backend/` | Borrado entero, con el `Dockerfile`, el `.dockerignore`, el servicio de systemd y las reglas de Maven del `.gitignore`. Sigue en el historial de git |
| `docker-compose.yml` | Borrado: PostgreSQL y Mailpit solo servían al backend Java |
| `tp2/` | La plantilla de CloudFormation, su diagrama y el runbook (`infra/README.md`), movidos tal cual, con una nota arriba que dice qué son |
| Frontend | Fuera lo que solo funcionaba contra Java: el default `localhost:8080`, los streams SSE con `EventSource` y el bloque de cuentas de demo del login (`owner@demo.q`, que ya no existe en ningún lado) |
| Documentación | README, `architecture.md`, `deployment.md` y `HANDOFF.md` reescritos; `api-reference.md`, `domain-model.md`, `gotchas.md` y `frontend.md` puestos al día |

### Decisiones que se apartan del roadmap

| Decisión | Por qué |
|---|---|
| **No hay API local; el frontend se desarrolla contra la del lab.** `next dev` hace de proxy de `/api/v1` y `config.json` hacia el sitio desplegado (`DEV_API_URL` en `.env.local`) | El roadmap pedía DynamoDB Local para desarrollo, pero los tests ya levantan el suyo con Testcontainers, y un servidor local de la API sería código nuevo (más un login falso, porque el navegador inicia sesión con Cognito). La API desplegada no tiene CORS porque sirve el sitio: con el proxy, el navegador solo habla con localhost, igual que en producción. Los ids de Cognito y el WebSocket salen del mismo `config.json`, así que también hay tiempo real |
| **El desarrollo local ya estaba roto** | El frontend inicia sesión con Cognito y el backend Java solo aceptaba sus propios tokens: con el backend levantado, el panel no funcionaba |
| **Se borró el bloque de demo del login** en lugar de apuntarlo al usuario de Terraform | Ese usuario tiene una contraseña aleatoria por despliegue: no hay nada fijo que mostrar, y una contraseña fija estaría en un repositorio público |
| **Los documentos se reescribieron**, no se movieron a `tp2/` | Decisión del equipo. Las versiones del TP2 quedan en el historial de git |
| `docs/` sigue en inglés | Como el resto de esos documentos y el README. ROADMAP, AVANCE y el código siguen en castellano |

### Verificado localmente

- typecheck, lint y build del frontend como en el pipeline (`/prod`), sin rastros de `localhost:8080`
  ni de las cuentas de demo en `out/`.
- El proxy de `next dev` contra una API falsa: GET y POST llegan con el `Host` del destino, el
  `Authorization` y el cuerpo; `config.json` también; `/login` y `/login/` cargan.
- La búsqueda de referencias al sistema anterior fuera de `tp2/`, `functions/` y los documentos de
  planificación: lo que queda está en pasado o explica los límites del lab.
- Todos los links relativos de los documentos apuntan a algo que existe.

### Falta, en el lab

- Borrar lo que quedó del TP2 en la cuenta (el stack, RDS, el balanceador, el Auto Scaling Group, el
  NAT Gateway) y el `app.env` del bucket de artefactos del TP2.
- **Revocar la contraseña de aplicación de Gmail** que estaba en ese `app.env`, y rotar la de RDS si
  la base sigue existiendo.

---

## Mails reales: el lab niega SES

El commit `701ae75` pasó al plan las variables del repositorio `SES_SENDER_EMAIL`,
`SES_VERIFIED_RECIPIENTS` y `ALERT_EMAIL`. Con las tres cargadas (el mail del grupo como remitente y
los cuatro del equipo como destinatarios), dos applies fallaron en las cinco identidades de SES; todo
lo demás se creó:

| Ejecución | Error |
|---|---|
| [39135312198](https://github.com/josebl123/tp-cloud/actions/runs/39135312198) | `ses:TagResource` denegado: `CreateEmailIdentity` manda los tags del `default_tags` en la misma llamada |
| [39167880552](https://github.com/josebl123/tp-cloud/actions/runs/39167880552) | Con las identidades sin tags (un provider con alias), `ses:CreateEmailIdentity` denegado |

Probado después desde CloudShell:

| | Resultado |
|---|---|
| `ses verify-email-identity` (API v1), con el rol del lab | `AccessDenied` |
| `ses get-identity-verification-attributes`, con el rol del lab | `AccessDenied` |
| `sesv2 send-email` al simulador de SES, con el rol del lab | `AccessDenied` sobre `ses:SendEmail` |
| `simulate-principal-policy` sobre `LabRole` | `explicitDeny` en `ses:SendEmail`, `ses:CreateEmailIdentity` y `ses:VerifyEmailIdentity` |

**En este lab no hay SES**, ni para el pipeline ni para las funciones, y un deny explícito no se
puede compensar con nada de nuestro lado. Decidido:

- Se borraron las variables `SES_SENDER_EMAIL` y `SES_VERIFIED_RECIPIENTS`: los avisos vuelven a
  simularse (el notifier los escribe en su log), que la consigna permite. El workflow las sigue
  pasando, para una cuenta donde SES esté permitido.
- `ALERT_EMAIL` queda: es una suscripción de SNS, que el lab sí permite, y se creó bien.
- Se revirtió el provider sin tags: arreglaba un problema real, pero la creación está negada igual.
- Descartado por ahora: mandar por el SMTP de Gmail desde el notifier. Entregaría a cualquier
  dirección, pero vuelve a haber un secreto (la contraseña de aplicación), justo lo que marcó la
  corrección del TP2.

Corregidos `deployment.md`, `gotchas.md`, `architecture.md`, `domain-model.md`, `HANDOFF.md`, el
README, `notifications.tf` y `terraform.tfvars.example`, que daban los mails reales como posibles en
el lab.

---

## Mails por el SMTP de Gmail

Como el lab niega SES, el equipo decidió mandar los avisos por el SMTP de Gmail, con la cuenta del
grupo y una contraseña de aplicación: el único secreto del sistema.

| | |
|---|---|
| Funciones | `SmtpMailer` (`functions/src/notifications/smtp.ts`), con nodemailer 10.0.13 fijado (sin dependencias ni scripts de instalación). El notifier lo usa si el despliegue trae `SMTP_SENDER` y `SMTP_SECRET_ID`; si no, SES. Mientras el secreto no tiene valor simula, y esa falta no se guarda; una contraseña incorrecta falla, así el aviso se reintenta y termina en la DLQ con su alarma |
| Terraform | Variable `smtp_sender_email`; el secreto `q-smtp` en Secrets Manager, **sin valor** y sin ventana de recuperación (con los 30 días por defecto, un apply después de un destroy no podría recrearlo); el notifier recibe el remitente y el ARN |
| Pipeline | Variable del repositorio `SMTP_SENDER_EMAIL` y secret `GMAIL_APP_PASSWORD`. El paso *Contraseña SMTP* escribe el valor con la CLI **después** del apply: por Terraform quedaría en texto plano en el plan guardado, que es un artefacto descargable del workflow, y en el estado. La prueba de humo se une a la cola de demo con el propio remitente, así cada despliegue manda un mail real al buzón del grupo |

Probado desde CloudShell antes de desplegar, por lo que pasó con SES:

| | Resultado |
|---|---|
| `secretsmanager create-secret` con tags | Permitido |
| `put-secret-value` y `delete-secret --force-delete-without-recovery` | Permitidos |
| `simulate-principal-policy` sobre `LabRole`: `secretsmanager:GetSecretValue`, `ssm:GetParameter`, `kms:Decrypt` | `allowed` los tres |

Verificado localmente: 132 tests (4 nuevos, con un transporte y un Secrets Manager falsos); el bundle
del notifier carga (437 KB con nodemailer) y su nodemailer llega a abrir la conexión (probado contra
un puerto cerrado); `fmt`, `validate` y actionlint sin hallazgos nuevos.

Sin verificar todavía: el envío real desde Lambda a `smtp.gmail.com:465`.

### Primer despliegue con SMTP: el stream perdió los eventos

Ejecución [39178976184](https://github.com/josebl123/tp-cloud/actions/runs/39178976184), desde
cero: 202 recursos creados y la contraseña cargada en Secrets Manager, pero la prueba de humo no
recibió el push por WebSocket y tampoco llegó el mail del ingreso. En CloudShell, los tres mappings
(`stream-publisher`, `broadcaster`, `notifier`) estaban `Enabled`, las colas vacías y **ninguna de
las tres funciones tenía invocaciones**: ningún evento salió del stream.

Causa: el mapping del stream empezaba en `LATEST`. Recién creado tarda unos minutos en empezar a
leer, y con `LATEST` lo escrito en ese rato se saltea: en un despliegue desde cero, la carga de demo y
la prueba de humo entera. Los applies que solo actualizaban pasaban porque el mapping ya existía.
Arreglo: `TRIM_HORIZON`, que lee desde lo más viejo que retiene el stream; releer al crearlo es
inofensivo porque los consumidores deciden con el estado actual.

**Resultado.** Con `TRIM_HORIZON` y la espera, la ejecución
[39180411198](https://github.com/josebl123/tp-cloud/actions/runs/39180411198) pasó entera: el apply
reemplazó el mapping, la contraseña quedó cargada, la prueba de humo esperó a `Stream: OK` y recibió
el push del WebSocket. **El mail real llegó**: un ingreso a la cola de demo desde el sitio desplegado
mandó "Ya tenés tu lugar en Mesas" desde `queue.cloud.itba@gmail.com` por el SMTP de Gmail.

---

## Revisión externa de Terraform

Otra revisión señaló siete puntos; todos eran ciertos y se arreglaron:

| Observación | Arreglo |
|---|---|
| Ninguna validación exigía enteros (`consumer_max_concurrency = 2.5` pasaba), y algunas variables no tenían ninguna | Enteros y rangos en la raíz y en los módulos; validación para la retención de logs, la expiración de registros de acceso y los seis límites de throttling |
| Relaciones entre parámetros sin comprobar | La DLQ guarda más que su cola; el techo del sitio no es menor que el de la API, y el de las rutas anónimas no es mayor; el umbral de atraso es positivo o null |
| El seed no se re-ejecuta si solo cambia su código | `triggers` con el hash del bundle (output nuevo `source_code_hash` del módulo de funciones). Como el bundle trae el dominio, corre en casi cada despliegue: inofensivo, es idempotente |
| `depends_on = [module.logs_bucket]` esperaba al módulo entero | Se pasa `module.logs_bucket.name`, que ya espera a la política. Se sigue conociendo en el plan: el test de la raíz lo comprueba, y falla con "Invalid count" si se le pasa un valor que no se conoce |
| El stage estaba en el workflow y en Terraform | `API_STAGE` del workflow llega a Terraform como `TF_VAR_api_stage_name` en el plan y el destroy |
| Sin tests de los módulos | `terraform test` en modo plan con providers simulados: la configuración entera y cada módulo, 16 corridas. Cada módulo trae su lock file con las versiones de la raíz. El job Validar los corre |
| Contratos de `private-bucket` implícitos | El README de cada módulo dice qué garantiza cada salida (`name` espera al bucket listo; `arn` se conoce en el plan y no espera) y los rangos de cada entrada |

Verificado localmente: `fmt`, `validate` de la raíz y de los módulos, los 16 tests, y actionlint sin
hallazgos nuevos. Se comprobó que los tests detectan lo que dicen: rompiendo el sufijo `.fifo` falla
el de la cola, y pasando al bucket de logs un valor desconocido en el plan falla el de la raíz.

---

## El destroy, diagnosticado

Dos personas vieron cosas sin destruir después del destroy. Ciclo completo en la cuenta 142609662802,
con un inventario por servicio antes y después: apply
[39501238265](https://github.com/josebl123/tp-cloud/actions/runs/39501238265) (202 recursos, prueba
de humo en verde) y destroy [39503540707](https://github.com/josebl123/tp-cloud/actions/runs/39503540707)
(202 destruidos y los tres buckets borrados).

Después del destroy no quedaba nada de Queue salvo dos cosas, ninguna una falla:

| | |
|---|---|
| El bucket del estado, `tfstate-q-<cuenta>-<región>` | Se conservaba a propósito. Con todo destruido el estado está vacío, así que ahora **el destroy también lo borra**, como último paso y solo si `terraform state list` está vacío; si no, lo conserva y avisa. El apply siguiente lo crea de nuevo |
| Cuatro user pools de Cognito en la API de tags (Tag Editor) | Fantasmas: uno por despliegue anterior. `list-user-pools` no devuelve ninguno y `describe-user-pool` responde `ResourceNotFoundException`. AWS los saca solo |

El orden del destroy es el esperado: primero los mappings de las colas y del stream, después cada
función y su log group. No quedó ningún log group recreado.

`buckets.sh delete-state` probado contra un S3 simulado: vacía de a páginas versiones y marcas de
borrado, borra el bucket, y una segunda corrida ve que ya no existe. shellcheck y actionlint sin
hallazgos nuevos.


---

## Revisión contra la consigna y la rúbrica, y diagrama nuevo

| | |
|---|---|
| Diagrama | `docs/diagrams/arquitectura.png`, con la convención de AWS: AWS Cloud, la región us-east-1 (sin VPC) y cada recurso del Terraform conectado con los que usa; afuera, el navegador, GitHub Actions/Terraform y Gmail. Sin agrupar por funcionalidad. Se genera con `docs/diagrams/arquitectura.py` y `render.mjs`, y está embebido en el README, en el de Terraform y en `architecture.md`. Reemplaza al de `tp3/`, que seguía mostrando SES como canal real |
| README de Terraform | La guía paso a paso que pide la consigna, en siete pasos y en castellano (antes era solo un link a `deployment.md`); el destroy en la tabla de requisitos; el aviso de `hash_key` deprecado que sale del módulo externo |
| `depends_on` sobrante | El de `aws_apigatewayv2_deployment.ws` y su comentario, que decía que la referencia en `triggers` no ordena la creación (sí la ordena) |
| ARNs | `arn:aws` escrito a mano en `data.tf` y `openapi.tf` pasa a `data.aws_partition` |
| Región | El workflow la pasa como `TF_VAR_region` desde `AWS_REGION`, como ya hacía con el stage |
| Credenciales | El plan corta con un mensaje claro si falta alguno de los tres secrets |
| Nombres | Todo en inglés: `cargar_demo` → `demo_enabled`, `email_alertas` → `alert_email` (y `TF_VAR_alert_email`), el bucket `artefactos` → `artifacts`, las alarmas `-stream-failures`, `-dlq-not-empty` y `-oldest-message` |
| `buckets.sh create` | Conserva los nombres anotados antes que ya no están en el plan, delante de los nuevos: con el renombre, el bucket `q-artefactos-…` de un despliegue existente sigue anotado y el destroy lo borra. Probado con un `aws` simulado |
| Regex de email | Repetida cinco veces en `variables.tf`; ahora es `local.email_pattern`, con un test que comprueba que la validación sigue rechazando un mail inválido |

**Efecto en un despliegue existente.** El próximo apply crea `q-artifacts-…`, mueve ahí los zips de
las funciones (las funciones se actualizan, no se recrean) y recrea las cinco alarmas con sus nombres
nuevos. `q-artefactos-…` queda vacío hasta el próximo destroy.

Verificado localmente: `fmt`, `validate`, tflint y actionlint sin hallazgos; `terraform test` 5/5 en
la raíz y 4/3/5 en los módulos.
