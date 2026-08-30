package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.service.GraceSweepJob;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Functionality 5: what happens when a called customer does not show up in time. */
@DisplayName("Grace period and no-show policies")
class GracePeriodIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private GraceSweepJob graceSweepJob;

    @Test
    @DisplayName("MOVE_TO_END sends the absent customer to the back of the line")
    void moveToEnd() throws Exception {
        Scenario scenario = scenarioWithPolicy("MOVE_TO_END", 3, "movetoend");

        clock.advance(Duration.ofSeconds(61));
        JsonNode ana = readTicket(scenario.anaToken());

        assertThat(ana.get("status").asText()).isEqualTo("WAITING");
        assertThat(ana.get("position").asInt()).isEqualTo(3);
        assertThat(ana.get("noShowCount").asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("KEEP_POSITION gives the place back exactly where it was")
    void keepPosition() throws Exception {
        Scenario scenario = scenarioWithPolicy("KEEP_POSITION", 3, "keep");

        clock.advance(Duration.ofSeconds(61));
        JsonNode ana = readTicket(scenario.anaToken());

        assertThat(ana.get("status").asText()).isEqualTo("WAITING");
        assertThat(ana.get("position").asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("MOVE_BACK drops the customer the configured number of places")
    void moveBack() throws Exception {
        Account owner = registerOwner("owner@moveback.q", "Optica Vision");
        UUID queueId = createQueue(owner, "Atencion", Map.of(
                "gracePeriodSeconds", 60,
                "noShowPolicy", "MOVE_BACK",
                "moveBackPositions", 1));
        JsonNode ana = join(queueId, "Ana", "ana@moveback.q");
        join(queueId, "Bruno", "bruno@moveback.q");
        join(queueId, "Carla", "carla@moveback.q");
        callNext(owner, queueId);

        clock.advance(Duration.ofSeconds(61));
        JsonNode reloaded = readTicket(ticketToken(ana));

        assertThat(reloaded.get("status").asText()).isEqualTo("WAITING");
        assertThat(reloaded.get("position").asInt()).isEqualTo(2);

        // And the rest of the line is still coherent around her.
        JsonNode board = board(owner, queueId);
        assertThat(board.get("waiting").findValuesAsText("customerName"))
                .containsExactly("Bruno", "Ana", "Carla");
    }

    @Test
    @DisplayName("REMOVE ends the customer's place for good")
    void remove() throws Exception {
        Scenario scenario = scenarioWithPolicy("REMOVE", 3, "remove");

        clock.advance(Duration.ofSeconds(61));
        JsonNode ana = readTicket(scenario.anaToken());

        assertThat(ana.get("status").asText()).isEqualTo("NO_SHOW");
        // Null fields are omitted from responses, so a removed customer simply has no position.
        assertThat(ana.has("position")).isFalse();
        assertThat(board(scenario.owner(), scenario.queueId()).get("waitingCount").asInt()).isEqualTo(2);
    }

    @Test
    @DisplayName("the grace period is not over until it is over")
    void doesNotExpireEarly() throws Exception {
        Scenario scenario = scenarioWithPolicy("REMOVE", 3, "early");

        clock.advance(Duration.ofSeconds(59));
        JsonNode ana = readTicket(scenario.anaToken());

        assertThat(ana.get("status").asText()).isEqualTo("CALLED");
        assertThat(ana.get("graceSecondsRemaining").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("a grace period of zero means staff decide, never the clock")
    void zeroGraceNeverExpires() throws Exception {
        Account owner = registerOwner("owner@nograce.q", "Kiosco 24h");
        UUID queueId = createQueue(owner, "Mostrador", Map.of("gracePeriodSeconds", 0));
        JsonNode ana = join(queueId, "Ana", "ana@nograce.q");
        callNext(owner, queueId);

        clock.advance(Duration.ofHours(2));
        JsonNode reloaded = readTicket(ticketToken(ana));

        assertThat(reloaded.get("status").asText()).isEqualTo("CALLED");
        assertThat(reloaded.has("graceSecondsRemaining")).isFalse();
    }

    @Test
    @DisplayName("staff can declare a no-show without waiting for the clock")
    void staffCanForceNoShow() throws Exception {
        Scenario scenario = scenarioWithPolicy("MOVE_TO_END", 3, "forced");
        JsonNode board = board(scenario.owner(), scenario.queueId());
        assertThat(board.get("inService")).hasSize(1);
        UUID anaEntryId = entryId(board.get("inService").get(0));

        setEntryStatus(scenario.owner(), anaEntryId, EntryStatus.NO_SHOW);

        assertThat(readTicket(scenario.anaToken()).get("position").asInt()).isEqualTo(3);
    }

    @Test
    @DisplayName("the background sweep resolves queues nobody is looking at")
    void backgroundSweepExpiresAbandonedCalls() throws Exception {
        Scenario scenario = scenarioWithPolicy("REMOVE", 2, "sweep");
        clock.advance(Duration.ofSeconds(61));

        graceSweepJob.sweep();

        // Read through the staff board, which never triggers expiry for an already-terminal entry.
        JsonNode board = board(scenario.owner(), scenario.queueId());
        assertThat(board.get("inServiceCount").asInt()).isZero();
        assertThat(readTicket(scenario.anaToken()).get("status").asText()).isEqualTo("NO_SHOW");
    }

    /** A queue with the given policy, {@code size} customers, and the first one already called. */
    private Scenario scenarioWithPolicy(String policy, int size, String slug) throws Exception {
        Account owner = registerOwner("owner@%s.q".formatted(slug), "Local " + slug);
        UUID queueId = createQueue(owner, "Fila", Map.of(
                "gracePeriodSeconds", 60,
                "noShowPolicy", policy));

        JsonNode ana = join(queueId, "Ana", "ana@%s.q".formatted(slug));
        for (int index = 1; index < size; index++) {
            join(queueId, "Customer " + index, "c%d@%s.q".formatted(index, slug));
        }
        callNext(owner, queueId);
        return new Scenario(owner, queueId, ticketToken(ana));
    }

    private record Scenario(Account owner, UUID queueId, UUID anaToken) {
    }
}
