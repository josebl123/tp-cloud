package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import ar.edu.itba.cloud.queue.config.InstanceHeaderFilter;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The endpoints and headers the infrastructure depends on.
 *
 * <p>These are easy to break silently — nothing in the product stops working if a health group is
 * misconfigured, right up until a load balancer quietly takes every instance out of service.
 */
@DisplayName("Operational surface")
class OperationalIntegrationTest extends AbstractIntegrationTest {

    @Test
    @DisplayName("readiness reports UP and is what the load balancer should poll")
    void readinessIsUp() throws Exception {
        assertThat(doGet("/actuator/health/readiness", null, 200).get("status").asText()).isEqualTo("UP");
    }

    @Test
    @DisplayName("liveness reports UP and does not depend on the database")
    void livenessIsUp() throws Exception {
        assertThat(doGet("/actuator/health/liveness", null, 200).get("status").asText()).isEqualTo("UP");
    }

    @Test
    @DisplayName("health never leaks internal detail to an unauthenticated caller")
    void healthHidesDetails() throws Exception {
        assertThat(doGet("/actuator/health", null, 200).has("components")).isFalse();
    }

    @Test
    @DisplayName("every response says which instance produced it")
    void responsesCarryTheInstanceId() throws Exception {
        Account owner = registerOwner("owner@ops.q", "Local ops");
        UUID queueId = createQueue(owner, "Fila", Map.of());

        MvcResult result = mockMvc.perform(get("/api/v1/public/queues/" + queueId)).andReturn();

        assertThat(result.getResponse().getHeader(InstanceHeaderFilter.HEADER)).isNotBlank();
    }

    @Test
    @DisplayName("the instance id is stamped on failures too, which is when you most need it")
    void errorResponsesAlsoCarryTheInstanceId() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/public/queues/" + UUID.randomUUID())).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        assertThat(result.getResponse().getHeader(InstanceHeaderFilter.HEADER)).isNotBlank();
    }
}
