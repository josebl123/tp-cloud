package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Functionality 1: the rules around the "datos minimos" a customer supplies. */
@DisplayName("Joining a queue")
class JoinValidationIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("a name alone is not enough - there must be somewhere to send the ticket link")
    void requiresAContactChannel() throws Exception {
        UUID queueId = openQueue("contact", Map.of());

        Map<String, Object> nameOnly = new HashMap<>();
        nameOnly.put("name", "Ana");
        JsonNode problem = doPost("/api/v1/public/queues/%s/entries".formatted(queueId), nameOnly, null, 400);

        assertThat(problem.get("code").asText()).isEqualTo("VALIDATION_FAILED");
        assertThat(problem.get("errors").toString()).contains("email address or a phone number");
    }

    @Test
    @DisplayName("a phone number on its own is a valid contact channel")
    void acceptsPhoneOnly() throws Exception {
        UUID queueId = openQueue("phone", Map.of());

        JsonNode ticket = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Bruno", "phone", "+5491100000000"), null, 201);

        assertThat(ticket.get("position").asInt()).isEqualTo(1);
        JsonNode notifications = doGet(
                "/api/v1/public/tickets/%s/notifications".formatted(ticketToken(ticket)), null, 200);
        assertThat(notifications.get(0).get("destination").asText()).isEqualTo("+5491100000000");
    }

    @Test
    @DisplayName("a blank name is rejected")
    void rejectsBlankName() throws Exception {
        UUID queueId = openQueue("blank", Map.of());

        doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "   ", "email", "x@blank.q"), null, 400);
    }

    @Test
    @DisplayName("a malformed email is rejected before it reaches the queue")
    void rejectsMalformedEmail() throws Exception {
        UUID queueId = openQueue("malformed", Map.of());

        JsonNode problem = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "not-an-email"), null, 400);

        assertThat(problem.get("errors").has("email")).isTrue();
    }

    @Test
    @DisplayName("a queue that asks for the party size will not take a booking without it")
    void enforcesPartySizeWhenRequired() throws Exception {
        UUID queueId = openQueue("party", Map.of("requirePartySize", true));

        JsonNode problem = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "ana@party.q"), null, 400);
        assertThat(problem.get("code").asText()).isEqualTo("PARTY_SIZE_REQUIRED");

        JsonNode ticket = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "ana@party.q", "partySize", 4), null, 201);
        assertThat(ticket.get("partySize").asInt()).isEqualTo(4);
    }

    @Test
    @DisplayName("a full queue turns people away instead of overpromising")
    void enforcesMaxSize() throws Exception {
        UUID queueId = openQueue("full", Map.of("maxSize", 1));
        join(queueId, "Ana", "ana@full.q");

        JsonNode problem = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Bruno", "email", "bruno@full.q"), null, 409);
        assertThat(problem.get("code").asText()).isEqualTo("QUEUE_FULL");

        assertThat(doGet("/api/v1/public/queues/" + queueId, null, 200).get("full").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("an unknown queue is a 404, not a 500")
    void unknownQueueIsNotFound() throws Exception {
        JsonNode problem = doPost("/api/v1/public/queues/%s/entries".formatted(UUID.randomUUID()),
                Map.of("name", "Ana", "email", "ana@ghost.q"), null, 404);

        assertThat(problem.get("code").asText()).isEqualTo("QUEUE_NOT_FOUND");
    }

    @Test
    @DisplayName("leaving twice is refused, and the ticket keeps its history")
    void cannotLeaveTwice() throws Exception {
        UUID queueId = openQueue("twice", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@twice.q");

        doDelete("/api/v1/public/tickets/" + ticketToken(ana), null, 200);
        JsonNode problem = doDelete("/api/v1/public/tickets/" + ticketToken(ana), null, 409);

        assertThat(problem.get("code").asText()).isEqualTo("ENTRY_NOT_ACTIVE");
        assertThat(readTicket(ticketToken(ana)).get("status").asText()).isEqualTo("LEFT");
    }

    @Test
    @DisplayName("emails are normalised so the same person is not stored two ways")
    void normalisesEmail() throws Exception {
        UUID queueId = openQueue("normalise", Map.of());

        JsonNode ticket = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "  Ana Perez  ", "email", "  Ana.Perez@Normalise.Q  "), null, 201);

        assertThat(ticket.get("customerName").asText()).isEqualTo("Ana Perez");
        JsonNode notifications = doGet(
                "/api/v1/public/tickets/%s/notifications".formatted(ticketToken(ticket)), null, 200);
        assertThat(notifications.get(0).get("destination").asText()).isEqualTo("ana.perez@normalise.q");
    }

    @Test
    @DisplayName("calling next on an empty queue is refused clearly")
    void callingAnEmptyQueue() throws Exception {
        Account owner = registerOwner("owner@empty.q", "Local empty");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        JsonNode problem = doPost("/api/v1/queues/%s/calls".formatted(queueId),
                Map.of(), owner.token(), 409);

        assertThat(problem.get("code").asText()).isEqualTo("QUEUE_EMPTY");
    }

    @Test
    @DisplayName("an illegal state transition is refused with an explanation")
    void rejectsIllegalTransition() throws Exception {
        Account owner = registerOwner("owner@transition.q", "Local T");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        join(queueId, "Ana", "ana@transition.q");
        UUID anaEntryId = entryId(board(owner, queueId).get("waiting").get(0));

        // A customer who has not been called cannot jump straight to being attended.
        JsonNode problem = doPut("/api/v1/entries/%s/status".formatted(anaEntryId),
                Map.of("status", "SERVING"), owner.token(), 409);

        assertThat(problem.get("code").asText()).isEqualTo("INVALID_TRANSITION");
    }

    private UUID openQueue(String slug, Map<String, Object> overrides) throws Exception {
        Account owner = registerOwner("owner@%s.q".formatted(slug), "Local " + slug);
        return createQueue(owner, "Fila", overrides);
    }
}
