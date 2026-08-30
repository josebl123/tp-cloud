package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationType;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Functionality 3: the alerts, and the guarantee that they fire once. */
@DisplayName("Turn notifications")
class NotificationIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("joining sends the ticket link to the contact channel supplied")
    void joinSendsTheTicketLink() throws Exception {
        Account owner = registerOwner("owner@notif1.q", "Local N1");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@notif1.q");

        List<String> types = typesFor(ticketToken(ana));
        assertThat(types).containsExactly(NotificationType.TICKET_CREATED.name());

        JsonNode notification = notificationsFor(ticketToken(ana)).get(0);
        assertThat(notification.get("status").asText()).isEqualTo("SENT");
        assertThat(notification.get("destination").asText()).isEqualTo("ana@notif1.q");
        // Email is off in tests, so delivery falls back to the always-available logging transport.
        assertThat(notification.get("channel").asText()).isEqualTo("LOG");
    }

    @Test
    @DisplayName("being called sends the turn alert")
    void callSendsTheTurnAlert() throws Exception {
        Account owner = registerOwner("owner@notif2.q", "Local N2");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@notif2.q");

        callNext(owner, queueId);

        assertThat(typesFor(ticketToken(ana))).contains(NotificationType.YOUR_TURN.name());
    }

    @Test
    @DisplayName("the proximity alert fires once per pass through the line, not on every movement")
    void proximityAlertIsNotRepeated() throws Exception {
        Account owner = registerOwner("owner@notif3.q", "Local N3");
        UUID queueId = createQueue(owner, "Fila", Map.of("notifyAtPosition", 1));
        join(queueId, "Ana", "ana@notif3.q");
        JsonNode bruno = join(queueId, "Bruno", "bruno@notif3.q");
        JsonNode carla = join(queueId, "Carla", "carla@notif3.q");

        // Carla starts with two people ahead, below the threshold, so nothing yet.
        assertThat(typesFor(ticketToken(carla)))
                .doesNotContain(NotificationType.APPROACHING_POSITION.name());

        UUID anaEntryId = entryId(callNext(owner, queueId));
        assertThat(countOf(ticketToken(carla), NotificationType.APPROACHING_POSITION)).isEqualTo(1);
        assertThat(countOf(ticketToken(bruno), NotificationType.APPROACHING_POSITION)).isEqualTo(1);

        // More movement in the same pass must not produce a second alert for the same person.
        setEntryStatus(owner, anaEntryId, ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.SERVED);
        assertThat(countOf(ticketToken(bruno), NotificationType.APPROACHING_POSITION)).isEqualTo(1);
        assertThat(countOf(ticketToken(carla), NotificationType.APPROACHING_POSITION)).isEqualTo(1);
    }

    @Test
    @DisplayName("a customer sent back into the line becomes eligible for the alerts again")
    void newPassThroughTheLineReopensTheAlerts() throws Exception {
        Account owner = registerOwner("owner@notif4.q", "Local N4");
        UUID queueId = createQueue(owner, "Fila", Map.of(
                "notifyAtPosition", 5,
                "gracePeriodSeconds", 60,
                "noShowPolicy", "MOVE_TO_END"));
        JsonNode ana = join(queueId, "Ana", "ana@notif4.q");
        join(queueId, "Bruno", "bruno@notif4.q");

        callNext(owner, queueId);
        assertThat(countOf(ticketToken(ana), NotificationType.YOUR_TURN)).isEqualTo(1);

        clock.advance(Duration.ofSeconds(61));
        readTicket(ticketToken(ana));
        assertThat(typesFor(ticketToken(ana))).contains(NotificationType.NO_SHOW.name());

        // Second pass: she is called again and must be told again.
        callNext(owner, queueId);
        callNext(owner, queueId);
        assertThat(countOf(ticketToken(ana), NotificationType.YOUR_TURN)).isEqualTo(2);
    }

    @Test
    @DisplayName("the time-based threshold fires from the estimated wait")
    void timeThresholdFires() throws Exception {
        Account owner = registerOwner("owner@notif5.q", "Local N5");
        UUID queueId = createQueue(owner, "Fila", Map.of(
                "defaultServiceMinutes", 5,
                "notifyAtMinutes", 6));
        JsonNode ana = join(queueId, "Ana", "ana@notif5.q");
        JsonNode bruno = join(queueId, "Bruno", "bruno@notif5.q");
        JsonNode carla = join(queueId, "Carla", "carla@notif5.q");

        // Ana waits 0 min and Bruno 5 min - both under the threshold. Carla waits 10 min.
        assertThat(typesFor(ticketToken(ana))).contains(NotificationType.APPROACHING_TIME.name());
        assertThat(typesFor(ticketToken(bruno))).contains(NotificationType.APPROACHING_TIME.name());
        assertThat(typesFor(ticketToken(carla))).doesNotContain(NotificationType.APPROACHING_TIME.name());
    }

    @Test
    @DisplayName("every notification is also recorded on the queue timeline")
    void notificationsAreAudited() throws Exception {
        Account owner = registerOwner("owner@notif6.q", "Local N6");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        join(queueId, "Ana", "ana@notif6.q");

        JsonNode events = doGet("/api/v1/queues/%s/events".formatted(queueId), owner.token(), 200);
        assertThat(events.findValuesAsText("type")).contains("NOTIFICATION_SENT");
    }

    private List<String> typesFor(UUID ticketToken) throws Exception {
        return notificationsFor(ticketToken).findValuesAsText("type");
    }

    private long countOf(UUID ticketToken, NotificationType type) throws Exception {
        return typesFor(ticketToken).stream().filter(type.name()::equals).count();
    }

    private JsonNode notificationsFor(UUID ticketToken) throws Exception {
        return doGet("/api/v1/public/tickets/%s/notifications".formatted(ticketToken), null, 200);
    }
}
