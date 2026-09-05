package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.config.InstanceId;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Announces a queue's change to every other instance, over the database.
 *
 * <p>Emitters live in the JVM holding the connection, so an instance can only push to the customers
 * attached to it. With more than one instance behind the load balancer, a customer on one node would
 * never hear about a change made on another. This closes that gap without adding a service: the
 * database everyone already shares is the broker.
 *
 * <p><strong>Sent before commit, on purpose.</strong> PostgreSQL holds a notification until the
 * transaction that issued it commits, and drops it if that transaction rolls back - so announcing from
 * inside the transaction makes the announcement exactly as atomic as the change itself, and costs no
 * extra round trip. Announcing after commit instead would need its own connection and could survive a
 * change that did not. PostgreSQL also collapses identical payloads within one transaction, so a
 * mutation that publishes several events for one queue still announces once.
 *
 * <p>{@code pg_notify} rather than the {@code NOTIFY} statement, because only the function form takes
 * the channel and the payload as parameters; {@code NOTIFY} demands literals.
 */
@Component
public class QueueChangeNotifier {

    private static final Logger log = LoggerFactory.getLogger(QueueChangeNotifier.class);

    private final JdbcTemplate jdbcTemplate;
    private final AppProperties properties;
    private final InstanceId instanceId;

    public QueueChangeNotifier(JdbcTemplate jdbcTemplate, AppProperties properties, InstanceId instanceId) {
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
        this.instanceId = instanceId;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onQueueChanged(QueueChangedEvent event) {
        if (!properties.realtime().enabled()) {
            return;
        }
        String payload = new QueueChangeNotification(event.queueId(), instanceId.value()).encode();
        try {
            jdbcTemplate.query("select pg_notify(?, ?)",
                    resultSet -> null, properties.realtime().channel(), payload);
        } catch (Exception ex) {
            // Never fail the change itself over the announcement: the instance that made it still
            // pushes to its own subscribers, and the rest catch up on their next read or reconnect.
            log.warn("Could not announce the change on queue {}: {}", event.queueId(), ex.getMessage());
        }
    }
}
