package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Who can do what")
class AuthorizationIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("staff endpoints reject requests with no token")
    void rejectsAnonymousStaffAccess() throws Exception {
        Account owner = registerOwner("owner@auth.q", "Local A");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        JsonNode problem = doGet("/api/v1/queues/%s/board".formatted(queueId), null, 401);
        assertThat(problem.get("code").asText()).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    @DisplayName("a member of another establishment cannot see or touch this one")
    void rejectsForeignMember() throws Exception {
        Account owner = registerOwner("owner@auth1.q", "Local A");
        Account stranger = registerOwner("owner@auth2.q", "Local B");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        JsonNode problem = doGet("/api/v1/queues/%s/board".formatted(queueId), stranger.token(), 403);
        assertThat(problem.get("code").asText()).isEqualTo("NOT_A_MEMBER");

        doPost("/api/v1/queues/%s/calls".formatted(queueId), Map.of(), stranger.token(), 403);
        doPatch("/api/v1/queues/" + queueId, Map.of("name", "Hijacked"), stranger.token(), 403);
    }

    @Test
    @DisplayName("STAFF operate the queue, OWNER configures it")
    void staffCanOperateButNotConfigure() throws Exception {
        Account owner = registerOwner("owner@roles.q", "Local Roles");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        join(queueId, "Ana", "ana@roles.q");

        doPost("/api/v1/establishments/%s/members".formatted(owner.establishmentId()), Map.of(
                "email", "staff@roles.q",
                "password", "staffpassword",
                "displayName", "Empleado",
                "role", "STAFF"), owner.token(), 201);
        String staffToken = login("staff@roles.q", "staffpassword");
        Account staff = new Account(staffToken, null, owner.establishmentId());

        // Day-to-day operation is allowed...
        assertThat(board(staff, queueId).get("waitingCount").asInt()).isEqualTo(1);
        assertThat(callNext(staff, queueId).get("status").asText()).isEqualTo("CALLED");

        // ...but configuration is not.
        JsonNode problem = doPatch("/api/v1/queues/" + queueId,
                Map.of("serviceStations", 4), staffToken, 403);
        assertThat(problem.get("code").asText()).isEqualTo("OWNER_ONLY");

        doPost("/api/v1/establishments/%s/queues".formatted(owner.establishmentId()),
                Map.of("name", "Otra fila"), staffToken, 403);
    }

    @Test
    @DisplayName("a garbage token is rejected rather than ignored")
    void rejectsInvalidToken() throws Exception {
        Account owner = registerOwner("owner@badtoken.q", "Local T");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        doGet("/api/v1/queues/%s/board".formatted(queueId), "not-a-real-jwt", 401);
    }

    @Test
    @DisplayName("a token stops working once its lifetime is over")
    void tokenExpires() throws Exception {
        Account owner = registerOwner("owner@expiry.q", "Local E");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        board(owner, queueId);

        // The default lifetime is twelve hours.
        clock.advance(java.time.Duration.ofHours(13));

        JsonNode problem = doGet("/api/v1/queues/%s/board".formatted(queueId), owner.token(), 401);
        assertThat(problem.get("code").asText()).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    @DisplayName("wrong credentials do not reveal whether the account exists")
    void loginFailuresAreUniform() throws Exception {
        registerOwner("owner@login.q", "Local L");

        JsonNode wrongPassword = doPost("/api/v1/auth/login",
                Map.of("email", "owner@login.q", "password", "totally-wrong"), null, 401);
        JsonNode unknownUser = doPost("/api/v1/auth/login",
                Map.of("email", "nobody@login.q", "password", "totally-wrong"), null, 401);

        assertThat(wrongPassword.get("code").asText()).isEqualTo("BAD_CREDENTIALS");
        assertThat(unknownUser.get("detail").asText()).isEqualTo(wrongPassword.get("detail").asText());
    }

    @Test
    @DisplayName("customer endpoints stay open, and a ticket only ever shows its own holder")
    void publicEndpointsNeedNoToken() throws Exception {
        Account owner = registerOwner("owner@public.q", "Local P");
        UUID queueId = createQueue(owner, "Fila", Map.of());
        JsonNode ana = join(queueId, "Ana", "ana@public.q");

        JsonNode ticket = readTicket(ticketToken(ana));
        assertThat(ticket.get("customerName").asText()).isEqualTo("Ana");
        // The line's other customers are never exposed to a ticket holder.
        assertThat(ticket.has("waiting")).isFalse();

        doGet("/api/v1/public/tickets/" + UUID.randomUUID(), null, 404);
    }
}
