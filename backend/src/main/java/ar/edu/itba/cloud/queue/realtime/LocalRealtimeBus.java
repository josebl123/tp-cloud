package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;

/**
 * Single-instance transport: the message never leaves the JVM.
 *
 * <p>Delivery is deferred to after commit by {@code @TransactionalEventListener}, giving the same
 * "never announce a change that rolled back" guarantee the PostgreSQL transport gets from the
 * database itself.
 *
 * <p>Used by the test suite, where a real notification round-trip would add latency and
 * non-determinism to assertions that are about queue behaviour, not about transport.
 */
public class LocalRealtimeBus implements RealtimeBus {

    private final ApplicationEventPublisher publisher;

    public LocalRealtimeBus(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Override
    public void publish(UUID queueId) {
        publisher.publishEvent(new QueueChangedEvent(queueId));
    }
}
