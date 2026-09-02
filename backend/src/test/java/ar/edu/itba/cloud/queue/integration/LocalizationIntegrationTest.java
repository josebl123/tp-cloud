package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The language a customer joins in has to survive: the email they get an hour later should match the
 * page they were reading when they took their place.
 */
@DisplayName("Notification language")
class LocalizationIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("an explicit locale in the request body wins")
    void explicitLocaleWins() throws Exception {
        UUID queueId = openQueue("explicit");

        JsonNode ticket = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "ana@explicit.q", "locale", "es"), null, 201);

        assertThat(firstSubject(ticket)).startsWith("Ya tenés tu lugar");
    }

    @Test
    @DisplayName("the Accept-Language header is used when the body says nothing")
    void acceptLanguageHeaderIsUsed() throws Exception {
        UUID queueId = openQueue("header");

        JsonNode ticket = doPostWithHeader("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Bruno", "email", "bruno@header.q"),
                "Accept-Language", "es-AR,es;q=0.9,en;q=0.8", 201);

        assertThat(firstSubject(ticket)).startsWith("Ya tenés tu lugar");
    }

    @Test
    @DisplayName("the body overrides a conflicting header")
    void bodyOverridesHeader() throws Exception {
        UUID queueId = openQueue("override");

        JsonNode ticket = doPostWithHeader("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Carla", "email", "carla@override.q", "locale", "en"),
                "Accept-Language", "es-AR", 201);

        assertThat(firstSubject(ticket)).startsWith("You're in the queue");
    }

    @Test
    @DisplayName("an unsupported language falls back to English instead of failing")
    void unsupportedLanguageFallsBack() throws Exception {
        UUID queueId = openQueue("fallback");

        JsonNode ticket = doPostWithHeader("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Dario", "email", "dario@fallback.q"),
                "Accept-Language", "fr-FR,fr;q=0.9", 201);

        assertThat(firstSubject(ticket)).startsWith("You're in the queue");
    }

    @Test
    @DisplayName("later notifications keep the language the customer joined in")
    void laterNotificationsStayInTheSameLanguage() throws Exception {
        Account owner = registerOwner("owner@later.q", "Local later");
        UUID queueId = createQueue(owner, "Fila", Map.of("gracePeriodSeconds", 120));

        JsonNode ticket = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "ana@later.q", "locale", "es"), null, 201);

        callNext(owner, queueId);

        JsonNode notifications = doGet(
                "/api/v1/public/tickets/%s/notifications".formatted(ticketToken(ticket)), null, 200);
        assertThat(notifications).hasSize(2);
        assertThat(notifications.get(1).get("type").asText()).isEqualTo("YOUR_TURN");
        assertThat(notifications.get(1).get("subject").asText()).startsWith("¡Es tu turno");
    }

    @Test
    @DisplayName("two customers in the same queue are each written to in their own language")
    void twoCustomersTwoLanguages() throws Exception {
        UUID queueId = openQueue("mixed");

        JsonNode spanish = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Ana", "email", "ana@mixed.q", "locale", "es"), null, 201);
        JsonNode english = doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", "Bruno", "email", "bruno@mixed.q", "locale", "en"), null, 201);

        assertThat(firstSubject(spanish)).startsWith("Ya tenés tu lugar");
        assertThat(firstSubject(english)).startsWith("You're in the queue");
    }

    private UUID openQueue(String slug) throws Exception {
        Account owner = registerOwner("owner@%s.q".formatted(slug), "Local " + slug);
        return createQueue(owner, "Fila", Map.of());
    }

    private String firstSubject(JsonNode ticket) throws Exception {
        return doGet("/api/v1/public/tickets/%s/notifications".formatted(ticketToken(ticket)), null, 200)
                .get(0).get("subject").asText();
    }
}
