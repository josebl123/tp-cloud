package ar.edu.itba.cloud.queue.integration;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.realtime.RealtimeBus;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The transport that makes more than one instance possible.
 *
 * <p>These tests act as a second instance: they open their own database session, LISTEN on the same
 * channel, and assert what PostgreSQL actually delivers. What is being verified is not that a method
 * was called, but that the guarantees the design leans on are real.
 */
@SpringBootTest(properties = {
        "q.realtime.mode=POSTGRES",
        "q.grace.sweep-interval=1h",
        "q.sse.heartbeat-interval=1h",
        "q.jwt.secret=integration-test-secret-key-0123456789abcdef",
})
@Import(TestSupportConfig.class)
@DisplayName("Cross-instance realtime transport")
class RealtimeBusIntegrationTest {

    private static final int WAIT_MILLIS = 4000;

    @Autowired
    private RealtimeBus realtimeBus;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private Connection listener;
    private PGConnection pgListener;

    @BeforeEach
    void subscribe() throws Exception {
        // A session standing in for another application instance.
        listener = dataSource.getConnection();
        try (Statement statement = listener.createStatement()) {
            statement.execute("LISTEN queue_changed");
        }
        drain();
    }

    @AfterEach
    void unsubscribe() throws Exception {
        if (listener != null) {
            listener.close();
        }
    }

    @Test
    @DisplayName("a committed change reaches another instance, carrying the queue id")
    void deliversAfterCommit() throws Exception {
        UUID queueId = UUID.randomUUID();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> realtimeBus.publish(queueId));

        assertThat(awaitPayloads()).containsExactly(queueId.toString());
    }

    @Test
    @DisplayName("a rolled-back change is never announced — the database enforces it, not the app")
    void deliversNothingOnRollback() throws Exception {
        UUID queueId = UUID.randomUUID();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            realtimeBus.publish(queueId);
            status.setRollbackOnly();
        });

        assertThat(awaitPayloads()).isEmpty();
    }

    @Test
    @DisplayName("repeated announcements inside one transaction collapse into a single delivery")
    void collapsesDuplicatesWithinATransaction() throws Exception {
        UUID queueId = UUID.randomUUID();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            realtimeBus.publish(queueId);
            realtimeBus.publish(queueId);
            realtimeBus.publish(queueId);
        });

        // Every listener rebuilds the whole board anyway, so one delivery is exactly what is wanted.
        assertThat(awaitPayloads()).containsExactly(queueId.toString());
    }

    @Test
    @DisplayName("separate queues arrive as separate messages")
    void keepsQueuesDistinct() throws Exception {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            realtimeBus.publish(first);
            realtimeBus.publish(second);
        });

        assertThat(awaitPayloads()).containsExactlyInAnyOrder(first.toString(), second.toString());
    }

    /** Collects whatever PostgreSQL pushes within the wait window. */
    private List<String> awaitPayloads() throws Exception {
        List<String> payloads = new ArrayList<>();
        PGNotification[] notifications = pgConnection().getNotifications(WAIT_MILLIS);
        if (notifications != null) {
            for (PGNotification notification : notifications) {
                payloads.add(notification.getParameter());
            }
        }
        return payloads;
    }

    private void drain() throws Exception {
        pgConnection().getNotifications(1);
    }

    private PGConnection pgConnection() throws Exception {
        if (pgListener == null) {
            pgListener = listener.unwrap(PGConnection.class);
        }
        return pgListener;
    }
}
