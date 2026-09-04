package ar.edu.itba.cloud.queue.realtime;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.UUID;
import java.util.regex.Pattern;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;

/**
 * Receives queue-change notifications from PostgreSQL and pushes them to this instance's own SSE
 * clients.
 *
 * <p>This is the half of the design that makes the API horizontally scalable. Staff can act on any
 * instance behind the load balancer; the customer's browser can be streaming from any other; the
 * database is what connects the two.
 *
 * <p><strong>Its own connection, on purpose.</strong> A listening session must stay open
 * indefinitely, so borrowing from the HikariCP pool would permanently remove a connection from it.
 * This opens one dedicated connection per instance, outside the pool.
 *
 * <p><strong>The work happens elsewhere.</strong> This thread decodes and hands off to
 * {@link BroadcastCoordinator}, which decides when to refresh and keeps one refresh per queue in
 * flight. Doing the refresh here would serialise every queue on the instance behind every other.
 *
 * <p><strong>Missing a notification is survivable.</strong> Delivery is at-most-once: an instance
 * that is reconnecting hears nothing during the gap. That is acceptable precisely because the
 * payload carries no state — only a queue id — and the client already falls back to polling whenever
 * its stream is down. The worst case is an update arriving seconds late, never a wrong one.
 */
public class PostgresNotificationListener implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(PostgresNotificationListener.class);

    /** A channel name goes into SQL as an identifier, so keep it to something unmistakably safe. */
    private static final Pattern SAFE_CHANNEL = Pattern.compile("[a-z_][a-z0-9_]{0,62}");

    private final BroadcastCoordinator coordinator;
    private final String jdbcUrl;
    private final String username;
    private final String password;
    private final String channel;
    private final Duration pollTimeout;
    private final Duration reconnectDelay;

    private volatile boolean running;
    private volatile Thread worker;

    public PostgresNotificationListener(BroadcastCoordinator coordinator,
                                        String jdbcUrl,
                                        String username,
                                        String password,
                                        String channel,
                                        Duration pollTimeout,
                                        Duration reconnectDelay) {
        if (!SAFE_CHANNEL.matcher(channel).matches()) {
            throw new IllegalArgumentException("Unsafe notification channel name: " + channel);
        }
        this.coordinator = coordinator;
        this.jdbcUrl = jdbcUrl;
        this.username = username;
        this.password = password;
        this.channel = channel;
        this.pollTimeout = pollTimeout;
        this.reconnectDelay = reconnectDelay;
    }

    @Override
    public void start() {
        if (running) {
            return;
        }
        running = true;
        Thread thread = Thread.ofPlatform()
                .name("pg-notify-listener")
                .daemon(true)
                .unstarted(this::listenForever);
        worker = thread;
        thread.start();
        log.info("Listening for '{}' notifications from PostgreSQL", channel);
    }

    @Override
    public void stop() {
        running = false;
        Thread thread = worker;
        if (thread != null) {
            thread.interrupt();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    /** Reconnects for as long as the application is up: a dropped connection is routine, not fatal. */
    private void listenForever() {
        while (running) {
            try {
                consume();
            } catch (Exception ex) {
                if (!running) {
                    return;
                }
                log.warn("Notification listener disconnected ({}), retrying in {}",
                        ex.getMessage(), reconnectDelay);
                sleepBeforeRetry();
            }
        }
    }

    private void consume() throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl, username, password)) {
            try (Statement statement = connection.createStatement()) {
                statement.execute("LISTEN " + channel);
            }
            PGConnection pgConnection = connection.unwrap(PGConnection.class);

            while (running && !connection.isClosed()) {
                // Blocks on the socket, so no polling query is needed to stay current.
                PGNotification[] notifications = pgConnection.getNotifications((int) pollTimeout.toMillis());
                if (notifications == null) {
                    continue;
                }
                for (PGNotification notification : notifications) {
                    handle(notification);
                }
            }
        }
    }

    /**
     * Decodes the notification and hands it on. Deliberately does no work of its own: this thread's
     * only job is to keep reading the connection, and anything slow here would stall every queue on
     * the instance, not just this one.
     */
    private void handle(PGNotification notification) {
        try {
            coordinator.request(UUID.fromString(notification.getParameter()));
        } catch (IllegalArgumentException ex) {
            log.warn("Ignoring notification with an unreadable payload: {}", notification.getParameter());
        } catch (Exception ex) {
            // One bad queue must not take the listener down with it.
            log.warn("Failed to schedule broadcast for {}: {}", notification.getParameter(), ex.getMessage());
        }
    }

    private void sleepBeforeRetry() {
        try {
            Thread.sleep(reconnectDelay.toMillis());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }
}
