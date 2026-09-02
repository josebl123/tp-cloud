package ar.edu.itba.cloud.queue.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Base for API tests that run against a real PostgreSQL.
 *
 * <p>Background jobs are pushed out of the way (sweep and heartbeat intervals set to an hour) so that
 * time-dependent behaviour is driven explicitly by {@link MutableClock} and never races the test.
 */
@SpringBootTest(properties = {
        "q.grace.sweep-interval=1h",
        "q.realtime.mode=LOCAL",
        "q.sse.heartbeat-interval=1h",
        "q.public-base-url=http://localhost:3000",
        "q.jwt.secret=integration-test-secret-key-0123456789abcdef",
        "q.notifications.email.enabled=false",
        "q.seed.enabled=false",
        "logging.level.org.hibernate.SQL=WARN"
})
@AutoConfigureMockMvc
@Import(TestSupportConfig.class)
abstract class AbstractIntegrationTest {

    protected static final String OWNER_PASSWORD = "supersecret1";

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected MutableClock clock;

    @Autowired
    private DatabaseCleaner databaseCleaner;

    @BeforeEach
    void resetState() {
        databaseCleaner.clean();
        clock.setInstant(TestSupportConfig.START);
    }

    // ------------------------------------------------------------- HTTP helpers

    protected JsonNode doPost(String path, Object body, String token, int expectedStatus) throws Exception {
        return perform(post(path), body, token, expectedStatus);
    }

    protected JsonNode doPut(String path, Object body, String token, int expectedStatus) throws Exception {
        return perform(put(path), body, token, expectedStatus);
    }

    protected JsonNode doPatch(String path, Object body, String token, int expectedStatus) throws Exception {
        return perform(patch(path), body, token, expectedStatus);
    }

    protected JsonNode doGet(String path, String token, int expectedStatus) throws Exception {
        return perform(get(path), null, token, expectedStatus);
    }

    protected JsonNode doDelete(String path, String token, int expectedStatus) throws Exception {
        return perform(delete(path), null, token, expectedStatus);
    }

    /** Same as {@link #doPost} but with one extra request header, for Accept-Language cases. */
    protected JsonNode doPostWithHeader(String path, Object body, String header, String value,
                                        int expectedStatus) throws Exception {
        return perform(post(path).header(header, value), body, null, expectedStatus);
    }

    private JsonNode perform(MockHttpServletRequestBuilder builder, Object body, String token,
                             int expectedStatus) throws Exception {
        if (body != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body));
        }
        if (token != null) {
            builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        }

        MvcResult result = mockMvc.perform(builder).andReturn();
        int actual = result.getResponse().getStatus();
        String content = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        if (actual != expectedStatus) {
            throw new AssertionError("Expected HTTP %d but got %d for %s. Body: %s".formatted(
                    expectedStatus, actual, result.getRequest().getRequestURI(), content));
        }
        return content.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(content);
    }

    // ----------------------------------------------------------- domain helpers

    /** Registers an owner with their establishment and returns the pieces tests need. */
    protected Account registerOwner(String email, String establishmentName) throws Exception {
        JsonNode response = doPost("/api/v1/auth/register", Map.of(
                "email", email,
                "password", OWNER_PASSWORD,
                "displayName", "Owner of " + establishmentName,
                "establishmentName", establishmentName), null, 201);

        return new Account(
                response.get("accessToken").asText(),
                UUID.fromString(response.get("user").get("id").asText()),
                UUID.fromString(response.get("establishment").get("id").asText()));
    }

    protected String login(String email, String password) throws Exception {
        return doPost("/api/v1/auth/login", Map.of("email", email, "password", password), null, 200)
                .get("accessToken").asText();
    }

    protected UUID createQueue(Account owner, String name, Map<String, Object> overrides) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.putAll(overrides);
        JsonNode response = doPost("/api/v1/establishments/%s/queues".formatted(owner.establishmentId()),
                body, owner.token(), 201);
        return UUID.fromString(response.get("id").asText());
    }

    protected JsonNode join(UUID queueId, String name, String email) throws Exception {
        return doPost("/api/v1/public/queues/%s/entries".formatted(queueId),
                Map.of("name", name, "email", email), null, 201);
    }

    protected UUID ticketToken(JsonNode ticket) {
        return UUID.fromString(ticket.get("ticketToken").asText());
    }

    protected JsonNode readTicket(UUID ticketToken) throws Exception {
        return doGet("/api/v1/public/tickets/" + ticketToken, null, 200);
    }

    protected JsonNode board(Account account, UUID queueId) throws Exception {
        return doGet("/api/v1/queues/%s/board".formatted(queueId), account.token(), 200);
    }

    protected JsonNode callNext(Account account, UUID queueId) throws Exception {
        return doPost("/api/v1/queues/%s/calls".formatted(queueId), Map.of(), account.token(), 200);
    }

    protected JsonNode setEntryStatus(Account account, UUID entryId, EntryStatus status) throws Exception {
        return doPut("/api/v1/entries/%s/status".formatted(entryId),
                Map.of("status", status.name()), account.token(), 200);
    }

    protected JsonNode setQueueStatus(Account account, UUID queueId, QueueStatus status) throws Exception {
        return doPut("/api/v1/queues/%s/status".formatted(queueId),
                Map.of("status", status.name()), account.token(), 200);
    }

    protected UUID entryId(JsonNode entry) {
        return UUID.fromString(entry.get("id").asText());
    }

    protected record Account(String token, UUID userId, UUID establishmentId) {
    }
}
