package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("A customer's full pass through a queue")
class QueueLifecycleIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("scan, join, wait, get called, get served - and the numbers stay consistent throughout")
    void fullLifecycle() throws Exception {
        Account owner = registerOwner("owner@lifecycle.q", "Parrilla La Espera");
        UUID queueId = createQueue(owner, "Mesas", Map.of(
                "serviceStations", 1,
                "defaultServiceMinutes", 10,
                "gracePeriodSeconds", 120));

        // What a customer sees right after scanning the QR.
        JsonNode landing = doGet("/api/v1/public/queues/" + queueId, null, 200);
        assertThat(landing.get("establishmentName").asText()).isEqualTo("Parrilla La Espera");
        assertThat(landing.get("acceptingEntries").asBoolean()).isTrue();
        assertThat(landing.get("waitingCount").asInt()).isZero();
        assertThat(landing.get("estimatedWaitMinutes").asInt()).isZero();

        JsonNode ana = join(queueId, "Ana Perez", "ana@lifecycle.q");
        JsonNode bruno = join(queueId, "Bruno Diaz", "bruno@lifecycle.q");
        JsonNode carla = join(queueId, "Carla Gomez", "carla@lifecycle.q");

        assertThat(ana.get("position").asInt()).isEqualTo(1);
        assertThat(bruno.get("position").asInt()).isEqualTo(2);
        assertThat(carla.get("position").asInt()).isEqualTo(3);
        assertThat(ana.get("ticketNumber").asLong()).isEqualTo(1);
        assertThat(carla.get("ticketNumber").asLong()).isEqualTo(3);

        // Ticket numbers are stable, positions are derived: Bruno has one person ahead.
        JsonNode brunoTicket = readTicket(ticketToken(bruno));
        assertThat(brunoTicket.get("peopleAhead").asInt()).isEqualTo(1);
        assertThat(brunoTicket.get("estimatedWaitMinutes").asInt()).isEqualTo(10);
        assertThat(brunoTicket.get("ticketUrl").asText())
                .isEqualTo("http://localhost:3000/t/" + ticketToken(bruno));

        JsonNode initialBoard = board(owner, queueId);
        assertThat(initialBoard.get("waitingCount").asInt()).isEqualTo(3);
        assertThat(initialBoard.get("inServiceCount").asInt()).isZero();
        assertThat(initialBoard.get("usingDefaultServiceTime").asBoolean()).isTrue();
        assertThat(initialBoard.get("estimatedWaitMinutesForNewEntry").asInt()).isEqualTo(30);

        // Staff calls the front of the line.
        JsonNode called = callNext(owner, queueId);
        assertThat(called.get("status").asText()).isEqualTo("CALLED");
        assertThat(called.get("customerName").asText()).isEqualTo("Ana Perez");
        assertThat(called.get("graceSecondsRemaining").asLong()).isEqualTo(120);

        // Ana no longer occupies a place in the waiting line, so Bruno moves up...
        JsonNode brunoAfterCall = readTicket(ticketToken(bruno));
        assertThat(brunoAfterCall.get("position").asInt()).isEqualTo(1);
        // ...but Ana still occupies the service station, so his estimate is not zero.
        assertThat(brunoAfterCall.get("estimatedWaitMinutes").asInt()).isEqualTo(10);

        UUID anaEntryId = entryId(called);
        assertThat(setEntryStatus(owner, anaEntryId, EntryStatus.SERVING).get("status").asText())
                .isEqualTo("SERVING");

        clock.advance(Duration.ofMinutes(6));
        JsonNode served = setEntryStatus(owner, anaEntryId, EntryStatus.SERVED);
        assertThat(served.get("status").asText()).isEqualTo("SERVED");

        // The real six-minute service now drives the estimate instead of the configured default.
        JsonNode boardAfterService = board(owner, queueId);
        assertThat(boardAfterService.get("usingDefaultServiceTime").asBoolean()).isFalse();
        assertThat(boardAfterService.get("averageServiceMinutes").asInt()).isEqualTo(6);
        assertThat(boardAfterService.get("waitingCount").asInt()).isEqualTo(2);

        // Functionality 5: Carla gives up her place.
        JsonNode left = doDelete("/api/v1/public/tickets/" + ticketToken(carla), null, 200);
        assertThat(left.get("status").asText()).isEqualTo("LEFT");
        assertThat(board(owner, queueId).get("waitingCount").asInt()).isEqualTo(1);

        JsonNode metrics = doGet("/api/v1/queues/%s/metrics?range=TODAY".formatted(queueId), owner.token(), 200);
        assertThat(metrics.get("servedCount").asLong()).isEqualTo(1);
        assertThat(metrics.get("leftCount").asLong()).isEqualTo(1);
        assertThat(metrics.get("noShowCount").asLong()).isZero();
        assertThat(metrics.get("waitingNow").asLong()).isEqualTo(1);
        assertThat(metrics.get("averageServiceMinutes").asInt()).isEqualTo(6);
        assertThat(metrics.get("abandonmentRate").asDouble()).isEqualTo(0.5);

        // The timeline recorded every step.
        JsonNode events = doGet("/api/v1/queues/%s/events".formatted(queueId), owner.token(), 200);
        assertThat(events.findValuesAsText("type"))
                .contains("QUEUE_CREATED", "ENTRY_JOINED", "ENTRY_CALLED", "ENTRY_SERVING_STARTED",
                        "ENTRY_SERVED", "ENTRY_LEFT");
    }

    @Test
    @DisplayName("pausing stops new customers but staff keep working through the line")
    void pauseBlocksJoinsButNotService() throws Exception {
        Account owner = registerOwner("owner@pause.q", "Cafe Central");
        UUID queueId = createQueue(owner, "Mostrador", Map.of());
        join(queueId, "Ana", "ana@pause.q");

        setQueueStatus(owner, queueId, QueueStatus.PAUSED);

        JsonNode landing = doGet("/api/v1/public/queues/" + queueId, null, 200);
        assertThat(landing.get("status").asText()).isEqualTo("PAUSED");
        assertThat(landing.get("acceptingEntries").asBoolean()).isFalse();

        JsonNode rejected = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Bruno", "email", "bruno@pause.q"), null, 409);
        assertThat(rejected.get("code").asText()).isEqualTo("QUEUE_NOT_ACCEPTING");

        // The person already in line can still be served.
        assertThat(callNext(owner, queueId).get("status").asText()).isEqualTo("CALLED");

        setQueueStatus(owner, queueId, QueueStatus.OPEN);
        assertThat(doGet("/api/v1/public/queues/" + queueId, null, 200)
                .get("acceptingEntries").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("closing a queue releases everyone still in it instead of stranding them")
    void closingReleasesTheLine() throws Exception {
        Account owner = registerOwner("owner@close.q", "Farmacia Norte");
        UUID queueId = createQueue(owner, "Turnos", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@close.q");
        JsonNode bruno = join(queueId, "Bruno", "bruno@close.q");

        setQueueStatus(owner, queueId, QueueStatus.CLOSED);

        assertThat(readTicket(ticketToken(ana)).get("status").asText()).isEqualTo("LEFT");
        assertThat(readTicket(ticketToken(bruno)).get("status").asText()).isEqualTo("LEFT");
        assertThat(board(owner, queueId).get("waitingCount").asInt()).isZero();

        JsonNode notifications = doGet(
                "/api/v1/public/tickets/%s/notifications".formatted(ticketToken(ana)), null, 200);
        assertThat(notifications.findValuesAsText("type")).contains("QUEUE_CLOSED");
    }

    @Test
    @DisplayName("staff can call a specific customer out of order")
    void callsOutOfOrder() throws Exception {
        Account owner = registerOwner("owner@skip.q", "Banco Sur");
        UUID queueId = createQueue(owner, "Caja", Map.of());
        join(queueId, "Ana", "ana@skip.q");
        JsonNode bruno = join(queueId, "Bruno", "bruno@skip.q");

        JsonNode board = board(owner, queueId);
        UUID brunoEntryId = entryId(board.get("waiting").get(1));

        JsonNode called = doPost("/api/v1/queues/%s/calls".formatted(queueId),
                Map.of("entryId", brunoEntryId.toString()), owner.token(), 200);

        assertThat(called.get("customerName").asText()).isEqualTo("Bruno");
        assertThat(readTicket(ticketToken(bruno)).get("status").asText()).isEqualTo("CALLED");
    }

    @Test
    @DisplayName("undoing a call puts the customer back where they were")
    void requeueKeepsPositionAfterAnAccidentalCall() throws Exception {
        Account owner = registerOwner("owner@undo.q", "Veterinaria Sol");
        UUID queueId = createQueue(owner, "Consultas", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@undo.q");
        join(queueId, "Bruno", "bruno@undo.q");

        UUID anaEntryId = entryId(callNext(owner, queueId));
        JsonNode back = setEntryStatus(owner, anaEntryId, EntryStatus.WAITING);

        assertThat(back.get("status").asText()).isEqualTo("WAITING");
        assertThat(back.get("position").asInt()).isEqualTo(1);
        assertThat(readTicket(ticketToken(ana)).get("position").asInt()).isEqualTo(1);
    }
}
