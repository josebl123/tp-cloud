package ar.edu.itba.cloud.queue.realtime;

import java.util.UUID;

/**
 * How "this queue moved" reaches every application instance.
 *
 * <p>The service layer calls {@link #publish(UUID)} and knows nothing else. That indirection is the
 * whole point: on one instance the message never leaves the JVM, and across an Auto Scaling Group it
 * travels through PostgreSQL — without a single business rule changing.
 *
 * <p>Implementations are expected to be called <em>inside</em> the transaction that made the change,
 * and to guarantee that nothing is delivered if that transaction rolls back.
 */
public interface RealtimeBus {

    void publish(UUID queueId);
}
