# Carriles, capacidad y ETA híbrida consistente

_Plan de ejecución vivo para unificar selección de turnos, estimación y representaciones de cola._

## Metadata

- **Owner:** equipo de `tp-cloud`
- **Created:** 2026-09-01
- **Last Updated:** 2026-09-01
- **Agent / Module:** `backend` (Spring/Flyway) y `frontend` (Next/TypeScript)
- **Related Plans:** ninguno
- **Plan Policy:** no existe `PLANS.md` en la raíz al momento de redactar este plan.

## Resultado esperado

Una misma simulación determinista decide qué grupo sería atendido y cuándo empieza su atención. La cotización pública para un tamaño de grupo, el alta, el ticket, el tablero y las notificaciones derivan sus ETA de esa simulación; ya no existen fórmulas lineales ni un `peopleAhead` ambiguo.

Hecho significa que las APIs distinguen orden dentro del carril, grupos esperando globalmente y grupos en servicio; una cola con puestos compartidos y varios carriles devuelve el mismo inicio estimado en todos sus flujos; y el frontend muestra esos datos sin duplicar entradas entre carriles.

## Purpose / Big Picture

Los carriles permiten reglas de elegibilidad y capacidad distintas (por ejemplo, grupos pequeños y grandes), pero los puestos de atención pertenecen a la cola completa. Una posición local por sí sola no predice el tiempo: la estrategia configurada puede atender antes grupos de otro carril y los grupos `CALLED`/`SERVING` ya reservan puestos. El simulador será la única fuente de verdad para esa predicción y hará visible el contexto correcto a personal y clientes.

La migración mantiene la compatibilidad con instalaciones que ya aplicaron `V1__init.sql`: cada cola existente recibe el carril activo `1+`, y sus entradas pasan a tener `party_size = 1` y dicho carril antes de que se impongan `NOT NULL`, FK, índices y checks.

## Context and Orientation

### Estado actual

- `backend/src/main/resources/db/migration/V1__init.sql` es una migración histórica aplicada: no se modifica, para conservar el checksum de Flyway.
- `backend/src/main/resources/db/migration/V2__queue_lanes.sql` agrega estrategia de llamada, carriles y el backfill de entradas. Debe seguir siendo la única migración de carriles.
- `backend/src/main/java/ar/edu/itba/cloud/queue/service/QueueEntryService.java` contiene hoy el selector privado `selectNext` y calcula posición/ETA con índices de listas.
- `backend/src/main/java/ar/edu/itba/cloud/queue/service/EstimationService.java` implementa la fórmula lineal `ceil((ahead + inService) / stations) * average`; se debe retirar de los flujos de producto.
- `backend/src/main/java/ar/edu/itba/cloud/queue/service/QueueViewFactory.java`, `TicketService.java`, `QueueService.java` y `NotificationService.java` fabrican vistas, snapshots, cotizaciones y avisos con el cálculo anterior.
- Los contratos actuales son `EntryView`, `TicketView`, `QueueSnapshot`, `PublicQueueView` y `QueueAvailabilityView` en `backend/src/main/java/ar/edu/itba/cloud/queue/service/model/`. `EntryView` y `TicketView` aún exponen `peopleAhead`; `QueueSnapshot` aún contiene `estimatedWaitMinutesForNewEntry`.
- La cotización está publicada por `GET /public/queues/{queueId}/availability?partySize=N` desde `PublicQueueController` y `QueueService.availability`. Actualmente ya selecciona carril y valida capacidad, pero su ETA sólo usa los grupos del carril.
- El QR público vive en `frontend/src/app/q/page.tsx`; el ticket en `frontend/src/app/t/page.tsx`; configuración y tablero en `frontend/src/app/panel/queue/settings/page.tsx` y `frontend/src/app/panel/queue/page.tsx`; contratos y cliente HTTP en `frontend/src/lib/types.ts` y `frontend/src/lib/api.ts`.

### Términos y contratos objetivo

- **Grupo activo:** una entrada con estado `WAITING`, `CALLED` o `SERVING`. `ServiceQueue.maxSize` limita el número global de esos grupos; el carril legado `1+` no replica ese límite.
- **Puesto:** una de `serviceStations` capacidades compartidas por todos los carriles.
- **Entrada candidata:** grupo que todavía no existe en base de datos y se agrega sólo en memoria para cotizar `partySize`.
- **ETA:** tiempo hasta el _inicio_ de atención, no hasta su finalización.
- **Datos explícitos de espera:** `lanePosition` (base 1), `laneGroupsAhead`, `globalWaitingGroupsAhead`, `groupsInService` y `estimatedWaitMinutes`. Se elimina `peopleAhead` de entidades expuestas, comandos, DTOs, tipos, UI y documentación; la columna histórica `service_queue.require_party_size` queda sin uso.

El selector reutilizable debe aceptar `ServiceQueue`, las entradas `WAITING` y un estado de rotación en memoria. Sus reglas son: `GLOBAL_AGE` por menor `orderKey`; `LANE_PRIORITY` por menor prioridad de carril y luego menor `orderKey`; `ROUND_ROBIN` comienza en `roundRobinPosition`, recorre establemente los carriles con espera y avanza la posición después de elegir. `callNext(queueId, laneId)` conserva la selección manual del primer grupo de ese carril como excepción explícita; sólo `callNext(queueId)` persiste el avance de round robin real.

## Plan of Work

### 1. Fijar esquema, entidades y capacidad global

1. Revisar `V1__init.sql` contra la metadata de Flyway y no modificarlo. Consolidar todos los DDL de carriles en `V2__queue_lanes.sql`: crear `queue_lane`, insertar `1+` por cola, normalizar `queue_entry.party_size` nulo a uno, asignar `lane_id`, y sólo entonces aplicar `NOT NULL`, FK, checks e índices.
2. Confirmar que la capacidad de `ServiceQueue.maxSize` cuenta grupos activos globales una única vez. `QueueLaneService` debe aplicar solamente la capacidad propia de carril (`GROUPS` o `PERSONS`) y no usar el carril `1+` para duplicar el máximo global.
3. Retirar el uso de `requirePartySize` de `ServiceQueue` expuesto, requests de crear/actualizar, comandos, vistas, seeder, cliente y documentación. Mantener la columna preexistente sin una migración destructiva.

**Validación y aceptación.** Crear una base desde V1 y aplicar V2; Flyway debe aceptar el checksum de V1. Verificar por SQL que cada cola tiene exactamente un `1+`, que cada entrada legada tiene `party_size = 1` y un `lane_id` válido, y que los checks rechazan cero/negativos. Cubrir límites de `queue.maxSize`, `max_size` de carril por grupos y por personas, incluidos los valores exactamente al límite.

**Comandos.** Desde `backend/`, ejecutar `mvn test` al terminar las pruebas de migración/integración. Capturar en el PR la salida de Flyway o la aserción de la prueba y un diff que muestre `V1` sin cambios.

**Recuperación.** No editar una migración ya aplicada fuera de este cambio de desarrollo. Si la consolidación falla en una base descartable, eliminar sólo la base de pruebas y reaplicar; para una base compartida, detener el despliegue y reparar mediante una migración nueva acordada, nunca mediante cambiar V1.

### 2. Extraer un selector determinista de turnos

1. Crear un servicio de dominio/aplicación, por ejemplo `QueueEntrySelector`, junto a `QueueEntryService`, con una API que entregue la próxima entrada y el próximo cursor round-robin sin efectos de persistencia.
2. Mover la lógica privada actual de `QueueEntryService.selectNext` a ese servicio. Definir orden de carriles round-robin estable (prioridad y un desempate estable, como ID), y documentar cómo un cursor basado en `roundRobinPosition` sigue siendo válido cuando un carril queda vacío.
3. Adaptar `QueueEntryService.callNext(queueId)` para usar el selector y persistir sólo el cursor resultante en `ROUND_ROBIN`; adaptar el simulador para utilizar exactamente el mismo selector y avanzar sólo estado simulado. Dejar `callNext(queueId, laneId)` fuera de la estrategia como llamada manual de carril.

**Validación y aceptación.** Pruebas unitarias: global por menor `orderKey`; prioridad por prioridad y luego `orderKey`; round robin con carriles vacíos, igual prioridad, rotación que cruza el final y cursor reproducible. Una llamada automática y una simulación con idéntica cola deben elegir el mismo primer grupo.

**Recuperación.** Mantener la persistencia del cursor limitada al flujo de llamada real; no dejar que un GET/cotización cambie `roundRobinPosition`.

### 3. Implementar el simulador de puestos compartidos

1. Rehacer `EstimationService` alrededor de una operación pura que reciba la cola, listas ordenadas de `WAITING` y `CALLED`/`SERVING`, una entrada objetivo existente o candidata, y el tiempo promedio ya resuelto.
2. Modelar `max(1, serviceStations)` puestos disponibles en tiempo cero. Reservar inmediatamente un puesto para cada grupo en `CALLED`/`SERVING` durante un servicio promedio completo multiplicado por `lane.timeFactor`.
3. Mientras haya espera, extraer la próxima entrada mediante `QueueEntrySelector`, asignarla al puesto que queda libre antes, y reservar `averageServiceTime * timeFactor` de su carril. Cuando se programe la entrada objetivo, retornar su instante de inicio menos cero (la ETA de inicio). Para una candidata, incluirla en memoria con orden de llegada posterior a todas las existentes y sin guardar nada.
4. Publicar un resultado de simulación que también permita derivar los contadores/posiciones explícitos sin depender de la ETA: posición y grupos delante en su carril, cantidad global `WAITING` delante, y cantidad `CALLED`/`SERVING`.
5. Eliminar o deprecar internamente los overloads lineales de `estimateWait(queue, peopleAhead, inService, ...)`; ningún servicio de producto debe invocarlos al finalizar este paso.

**Validación y aceptación.** Pruebas para: un puesto y dos puestos; ocupación inicial por `CALLED`/`SERVING`; factores distintos; prioridad que adelanta otro carril; round robin; candidato; y ETA igual al inicio simulado, no al fin. Agregar una propiedad de determinismo: mismas entradas y cursor producen el mismo resultado, sin mutar la cola, entradas ni cursor persistido.

**Recuperación.** Mantener la fórmula anterior sólo hasta que todas las fábricas y notificaciones hayan migrado en el mismo cambio; después eliminarla y usar el compilador/búsqueda para garantizar que no sobrevive ningún llamado.

### 4. Migrar APIs, vistas, ticket y notificaciones a la simulación

1. Introducir los cinco campos explícitos en `EntryView` y `TicketView`, actualizar `QueueViewFactory`, `QueueEntryService` y `TicketService` para pedir un resultado del simulador para cada `WAITING`. Para estados no esperando, definir de forma consistente los campos de espera como `null` o no aplicables, conservando `groupsInService` si corresponde al contrato final.
2. Cambiar `QueueSnapshot` y `PublicQueueView` para que no anuncien una ETA genérica de una llegada desconocida. El snapshot debe contener los datos de entradas existentes y resumen global; no `estimatedWaitMinutesForNewEntry`.
3. Completar `QueueAvailabilityView` y `QueueService.availability`: carril elegido, elegibilidad, `available`, disponibilidad global/carril, `lanePosition`, `laneGroupsAhead`, `globalWaitingGroupsAhead`, `groupsInService` y ETA de la candidata. El endpoint es de sólo consulta: no crea entrada, no altera cursor y no emite eventos.
4. Reemplazar en `NotificationService` el cálculo posicional por simulación por entrada antes de evaluar umbrales y construir texto de aviso. Verificar que archivado/liberación sigue evaluando notificaciones, conserva historial y publica SSE.
5. Actualizar controladores, requests/responses, OpenAPI/comentarios y `docs/domain-model.md` para reflejar los nombres nuevos y la eliminación de `requirePartySize`/`peopleAhead`.

**Validación y aceptación.** Pruebas de integración para join, GET ticket, snapshot y availability con una misma configuración deben coincidir en la ETA de una entrada concreta. Confirmar que sólo availability da ETA para una llegada potencial; GET público general y tablero no. Confirmar que archivado libera entradas, encola notificaciones, guarda el historial y emite SSE.

**Comandos.** Desde `backend/`: `mvn test`. Buscar residuos con `rg -n 'peopleAhead|requirePartySize|estimatedWaitMinutesForNewEntry|estimateWait\\(' backend/src frontend/src docs` y resolver cada uso que no sea una columna histórica o una prueba explícita de compatibilidad.

### 5. Adaptar el frontend sin duplicar grupos

1. Actualizar `frontend/src/lib/types.ts` y `frontend/src/lib/api.ts` a los contratos explícitos y borrar tipos/campos de `peopleAhead` y `requirePartySize`.
2. En `frontend/src/app/q/page.tsx`, mantener debounce y cancelación de solicitudes de cotización tras un `partySize` válido; mostrar elegibilidad, carril seleccionado, posición local, conteos globales separados y ETA. Impedir el join si availability no está disponible, sin tratar una cotización pendiente como afirmación de disponibilidad.
3. En `frontend/src/app/t/page.tsx`, reemplazar el progreso y etiquetas basados en personas por grupos/posición de carril y contexto global explícito. No inferir progreso a partir de una estrategia que puede cambiar por llamadas manuales.
4. En `frontend/src/app/panel/queue/settings/page.tsx`, habilitar la edición de todos los campos de un carril existente, conservar el diálogo de confirmación al eliminar y explicar que menor prioridad numérica se llama antes.
5. En `frontend/src/app/panel/queue/page.tsx`, con más de un carril renderizar listas separadas por carril y un resumen global sin repetir entradas. Con sólo el carril `1+`, conservar el tablero simple.

**Validación y aceptación.** Pruebas de UI para debounce/cancelación y bloqueo de join, edición completa de carril/eliminación confirmada, y tablero con dos carriles sin duplicados; prueba de regresión para el único carril `1+`. Verificar tipos con `npm run typecheck`.

**Comandos.** Desde `frontend/`: `npm ci`, `npm run lint`, `npm run typecheck` y `npm run build`. Guardar la salida de cada comando en la evidencia de la tarea.

### 6. Cierre y verificación transversal

1. Ejecutar las suites backend y frontend desde árboles limpios de dependencias según los comandos de los pasos anteriores.
2. Revisar `git diff --check`, `git diff -- backend/src/main/resources/db/migration/V1__init.sql`, y los resultados de la búsqueda de símbolos retirados.
3. Probar manualmente o en E2E una cola con dos carriles, dos puestos y una llamada manual de carril: documentar que la próxima cotización puede cambiar porque la operación real contradijo la estrategia, pero cada respuesta sigue siendo consistente con el estado actual.

**Recuperación.** Si una prueba revela discrepancia de ETA, aislar primero el input común (orden de waiting, in-service, cursor y promedio) y corregir el simulador/selector, no agregar ajustes específicos a join, ticket, tablero o notificaciones.

## Progress

- [x] (2026-09-01 13:38 Z) Creado el plan autocontenido en `.agents/plans/hybrid-lane-eta/PLAN.md`.
- [x] (2026-09-01 13:38 Z) Inspeccionada la base actual: V1/V2, selector en `QueueEntryService`, fórmula lineal de `EstimationService`, contratos y consumidores frontend.
- [x] (2026-09-01 15:02 Z) Extraído `QueueEntrySelector`; la llamada automática y la simulación comparten reglas GLOBAL_AGE, LANE_PRIORITY y ROUND_ROBIN, mientras la llamada manual de carril permanece explícita.
- [x] (2026-09-01 15:02 Z) Implementado el simulador de puestos compartidos en `EstimationService`, incluida la entrada candidata de availability y factores por carril.
- [x] (2026-09-01 15:02 Z) Migrados join, ticket, snapshot, availability y evaluación de umbrales a resultados del simulador; los contratos exponen posición/contexto explícitos y se retiró el ETA genérico de snapshot, vista pública y panel.
- [x] (2026-09-01 15:02 Z) Actualizados tipos y vistas QR, ticket y tablero para los nuevos campos y listas de carriles sin duplicación.
- [x] (2026-09-01 15:02 Z) Verificados `backend: mvn -q -DskipTests compile`, `frontend: npm run typecheck`, `frontend: npm run lint` y `git diff --check`.
- [ ] Ejecutar la suite de integración backend con Docker disponible y el build frontend en un entorno que permita a Turbopack abrir su puerto auxiliar.

## Surprises & Discoveries

- El árbol de trabajo ya contiene cambios no confirmados relacionados con carriles, contratos, controlador y frontend, además de `V2__queue_lanes.sql` sin seguimiento. El trabajo de implementación debe preservarlos y partir de ellos, no sobrescribirlos.
- `V2__queue_lanes.sql` ya sigue el orden correcto de backfill antes de `NOT NULL`/FK y deja `1+` sin máximo de carril, lo cual es coherente con que el máximo de cola sea global.
- La disponibilidad pública actual ya selecciona carril y comprueba ambas capacidades, pero calcula ETA sólo a partir de espera local; ésta es la brecha principal a cerrar.
- La sesión anterior montaba `.agents` de sólo lectura; esta sesión ya permitió crear el plan.
- `mvn -q test` llega a compilar las pruebas pero 37 pruebas de integración no arrancan porque Testcontainers no encuentra `/var/run/docker.sock`; no es una aserción funcional fallida.
- `npm run build` falla antes de compilar la aplicación porque Turbopack intenta crear un proceso/abrir un puerto y recibe `Operation not permitted`; typecheck y lint terminaron correctamente.

## Decision Log

- **Decision:** V1 no se modifica y V2 sigue siendo la única migración de carriles.
  **Rationale:** Evita invalidar checksums Flyway de bases existentes y conserva una actualización reproducible desde V1.
  **Date/Author:** 2026-09-01 — equipo.

- **Decision:** Los puestos son globales a la cola y se simulan compartidos entre carriles.
  **Rationale:** El número de puestos configura capacidad de atención de la cola, no de cada segmento; duplicarlos por carril produciría ETA falsas.
  **Date/Author:** 2026-09-01 — equipo.

- **Decision:** `CALLED` y `SERVING` consumen un servicio promedio completo ajustado por factor de carril.
  **Rationale:** No se dispone de progreso fiable del servicio actual; la misma reserva determinista evita falsa precisión.
  **Date/Author:** 2026-09-01 — equipo.

- **Decision:** Sólo `availability?partySize=N` cotiza una llegada nueva.
  **Rationale:** Snapshot, tablero y vista pública general no conocen tamaño/carril de la hipotética llegada; mostrar un ETA genérico sería ambiguo.
  **Date/Author:** 2026-09-01 — equipo.

- **Decision:** Las llamadas manuales de carril no se fuerzan a respetar la estrategia.
  **Rationale:** Son una intervención intencional del personal; las cotizaciones posteriores recalculan desde el estado real.
  **Date/Author:** 2026-09-01 — equipo.

## Risks / Open Questions

- Definir en tests el desempate estable de round robin entre carriles de igual prioridad; debe ser independiente del orden incidental de JPA.
- Definir explícitamente cuáles campos de espera se representan como `null` para entradas que ya no son `WAITING`, y actualizar frontend/API en conjunto.
- La simulación por cada entrada puede ser costosa con colas grandes. Primero medir sobre los límites reales; sólo optimizar si las pruebas/perfil muestran necesidad, sin reintroducir fórmulas divergentes.
- Las llamadas manuales pueden cambiar una ETA ya entregada; el producto debe comunicar que son estimaciones y recotizar/refrescar por SSE.

## Outcomes & Retrospective

La implementación central está terminada y compila. Falta ejecutar integración real de Flyway/HTTP/SSE con Docker operativo y un build Next en un entorno que permita el proceso auxiliar de Turbopack.

## Next Steps / Handoff Notes

Con Docker Desktop/daemon iniciado en WSL, ejecutar `cd backend && mvn test`. Para el build, ejecutar `cd frontend && npm run build` desde un entorno que permita bind local; revisar las seis advertencias de lint por separado.
