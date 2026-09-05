package ar.edu.itba.cloud.queue.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.config.AppProperties;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@DisplayName("Counting open SSE streams")
class SseHubTest {

    private SseHub hub;

    @BeforeEach
    void setUp() {
        // Bound from defaults rather than constructed positionally, so adding a property to
        // AppProperties does not break this test.
        AppProperties properties = Binder.get(new StandardEnvironment())
                .bindOrCreate("q", AppProperties.class);
        hub = new SseHub(properties);
    }

    @Test
    @DisplayName("an instance holding nothing reports nothing")
    void startsEmpty() {
        assertThat(hub.ticketConnections()).isZero();
        assertThat(hub.staffConnections()).isZero();
    }

    @Test
    @DisplayName("customers and staff are counted apart, across queues")
    void countsEachAudienceSeparately() {
        UUID lunch = UUID.randomUUID();
        UUID dinner = UUID.randomUUID();

        hub.subscribeTicket(lunch, UUID.randomUUID());
        hub.subscribeTicket(lunch, UUID.randomUUID());
        hub.subscribeTicket(dinner, UUID.randomUUID());
        hub.subscribeStaff(lunch);

        assertThat(hub.ticketConnections()).isEqualTo(3);
        assertThat(hub.staffConnections()).isEqualTo(1);
    }

    @Test
    @DisplayName("the same customer on two devices counts as two streams")
    void countsEveryStreamOfOneTicket() {
        UUID queueId = UUID.randomUUID();
        UUID ticketToken = UUID.randomUUID();

        hub.subscribeTicket(queueId, ticketToken);
        hub.subscribeTicket(queueId, ticketToken);

        assertThat(hub.ticketConnections()).isEqualTo(2);
    }

    @Test
    @DisplayName("closing a stream gives its place back")
    void cleanupDecrements() {
        UUID queueId = UUID.randomUUID();
        UUID ticketToken = UUID.randomUUID();
        SseEmitter emitter = hub.subscribeTicket(queueId, ticketToken);
        SseEmitter staff = hub.subscribeStaff(queueId);

        hub.removeTicket(queueId, ticketToken, emitter);
        hub.removeStaff(queueId, staff);

        assertThat(hub.ticketConnections()).isZero();
        assertThat(hub.staffConnections()).isZero();
    }

    /**
     * A stream can be cleaned up more than once - onError and onCompletion both fire for a connection
     * that dies badly. A counter that trusted the callback would drift below what is really open, and an
     * Auto Scaling Group reading it would keep shrinking a group that is actually full.
     */
    @Test
    @DisplayName("cleaning the same stream twice only frees it once")
    void cleanupIsIdempotent() {
        UUID queueId = UUID.randomUUID();
        UUID ticketToken = UUID.randomUUID();
        SseEmitter first = hub.subscribeTicket(queueId, ticketToken);
        hub.subscribeTicket(queueId, ticketToken);
        SseEmitter staff = hub.subscribeStaff(queueId);
        hub.subscribeStaff(queueId);

        hub.removeTicket(queueId, ticketToken, first);
        hub.removeTicket(queueId, ticketToken, first);
        hub.removeStaff(queueId, staff);
        hub.removeStaff(queueId, staff);

        assertThat(hub.ticketConnections()).isEqualTo(1);
        assertThat(hub.staffConnections()).isEqualTo(1);
    }
}
