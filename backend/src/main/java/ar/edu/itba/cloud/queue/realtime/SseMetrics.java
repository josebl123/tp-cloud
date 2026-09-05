package ar.edu.itba.cloud.queue.realtime;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Publishes how many live streams this instance is holding, as {@code q.sse.connections}.
 *
 * <p>This is the number that actually describes the load on an instance. Virtual threads let one node
 * hold thousands of open Server-Sent Events streams at almost no CPU cost, so CPU utilisation stays flat
 * while memory, sockets and file descriptors climb - which makes CPU a poor signal to scale on.
 *
 * <p>The Auto Scaling Group scales on {@code ASGAverageNetworkOut}, a predefined metric that grows with
 * the number of open streams because each one takes a heartbeat and an update on every movement of its
 * queue. Turning that into a byte target means knowing how many connections produced those bytes, which
 * is what this gauge answers. Publishing this value directly would be the better signal, and the counter
 * it reads is already here for whenever that becomes available.
 *
 * <p>Tagged by audience because the two behave nothing alike: staff streams are a handful per
 * establishment, customer streams are the whole line at once.
 */
@Component
public class SseMetrics {

    private static final String NAME = "q.sse.connections";
    private static final String DESCRIPTION = "Open Server-Sent Events streams held by this instance";

    public SseMetrics(SseHub hub, MeterRegistry registry) {
        Gauge.builder(NAME, hub, SseHub::ticketConnections)
                .tag("audience", "ticket")
                .description(DESCRIPTION)
                .baseUnit("connections")
                .register(registry);

        Gauge.builder(NAME, hub, SseHub::staffConnections)
                .tag("audience", "staff")
                .description(DESCRIPTION)
                .baseUnit("connections")
                .register(registry);
    }
}
