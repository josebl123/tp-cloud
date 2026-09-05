package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.config.InstanceId;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Listens for the changes other instances announce, and pushes them to this instance's subscribers.
 *
 * <p>The other half of {@link QueueChangeNotifier}. Together they make the fan-out reach every
 * customer regardless of which instance the load balancer put them on, which is what lets the Auto
 * Scaling Group run more than one node without the live updates going quiet.
 *
 * <p><strong>Its own connection, outside the pool.</strong> A listening session is held open for the
 * life of the process. Borrowing it from HikariCP would take one of the ten permanently and read to
 * the pool as a leak, so it is opened directly. Budget one extra connection per instance against the
 * database's {@code max_connections}.
 *
 * <p><strong>Announcements the instance made itself are skipped.</strong> It has already pushed them
 * from {@code RealtimeBroadcaster}, at commit, without waiting for the round trip. That also means
 * local subscribers keep being served normally even while this listener is disconnected - a failover
 * degrades the fan-out to single-instance behaviour rather than stopping it.
 *
 * <p>The loop reopens the connection whenever it drops, because it will: an RDS Multi-AZ failover
 * takes the session with it.
 */
@Component
public class QueueChangeListener implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(QueueChangeListener.class);

    /** A channel name goes into SQL unparameterised - LISTEN takes no bind variables. */
    private static final Pattern SAFE_CHANNEL = Pattern.compile("[a-z_][a-z0-9_]{0,62}");

    private final AppProperties properties;
    private final DataSourceProperties dataSourceProperties;
    private final RealtimeBroadcaster broadcaster;
    private final InstanceId instanceId;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ExecutorService executor;
    private volatile Connection connection;

    public QueueChangeListener(AppProperties properties,
                               DataSourceProperties dataSourceProperties,
                               RealtimeBroadcaster broadcaster,
                               InstanceId instanceId) {
        this.properties = properties;
        this.dataSourceProperties = dataSourceProperties;
        this.broadcaster = broadcaster;
        this.instanceId = instanceId;
    }

    @Override
    public void start() {
        if (!properties.realtime().enabled()) {
            log.info("Cross-instance fan-out is off; this instance only serves its own subscribers");
            return;
        }
        String channel = properties.realtime().channel();
        if (!SAFE_CHANNEL.matcher(channel).matches()) {
            // Refuse rather than interpolate something unexpected into a LISTEN statement.
            throw new IllegalStateException(
                    "q.realtime.channel must match " + SAFE_CHANNEL.pattern() + ", was: " + channel);
        }
        if (!running.compareAndSet(false, true)) {
            return;
        }
        executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "queue-change-listener");
            thread.setDaemon(true);
            return thread;
        });
        executor.submit(this::listen);
        log.info("Listening for queue changes on '{}' as instance {}", channel, instanceId);
    }

    @Override
    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        closeQuietly(connection);
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    /** Started late and stopped early, so it never outlives the things it pushes into. */
    @Override
    public int getPhase() {
        return Integer.MAX_VALUE - 100;
    }

    private void listen() {
        long reconnectDelay = properties.realtime().reconnectDelay().toMillis();
        while (running.get()) {
            try {
                consume();
            } catch (Exception ex) {
                if (!running.get()) {
                    return;
                }
                log.warn("Lost the queue-change channel, reopening in {}ms: {}", reconnectDelay,
                        ex.getMessage());
            }
            if (running.get() && !sleep(reconnectDelay)) {
                return;
            }
        }
    }

    /** Holds one session open, reading notifications, until it fails or the application stops. */
    private void consume() throws Exception {
        int pollTimeout = (int) properties.realtime().pollTimeout().toMillis();

        try (Connection conn = open()) {
            connection = conn;
            try (Statement statement = conn.createStatement()) {
                statement.execute("LISTEN " + properties.realtime().channel());
            }
            PGConnection pgConnection = conn.unwrap(PGConnection.class);
            log.info("Queue-change channel open");

            while (running.get() && !conn.isClosed()) {
                // Blocks until something arrives or the timeout elapses; the timeout is only there so
                // the loop gets a chance to notice it should stop.
                PGNotification[] notifications = pgConnection.getNotifications(pollTimeout);
                if (notifications == null) {
                    continue;
                }
                for (PGNotification notification : notifications) {
                    handle(notification.getParameter());
                }
            }
        } finally {
            connection = null;
        }
    }

    private void handle(String payload) {
        QueueChangeNotification notification = QueueChangeNotification.decode(payload);
        if (notification == null) {
            log.warn("Ignoring an unreadable queue-change payload: {}", payload);
            return;
        }
        if (notification.isFrom(instanceId.value())) {
            return;
        }
        try {
            broadcaster.broadcast(notification.queueId());
        } catch (Exception ex) {
            // One bad queue must not take down the channel every other queue depends on.
            log.warn("Could not push the change announced for queue {}: {}",
                    notification.queueId(), ex.getMessage());
        }
    }

    private Connection open() throws Exception {
        return DriverManager.getConnection(
                dataSourceProperties.determineUrl(),
                dataSourceProperties.determineUsername(),
                dataSourceProperties.determinePassword());
    }

    private boolean sleep(long millis) {
        try {
            TimeUnit.MILLISECONDS.sleep(millis);
            return true;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void closeQuietly(Connection conn) {
        if (conn == null) {
            return;
        }
        try {
            conn.close();
        } catch (Exception ex) {
            log.debug("Could not close the listening connection: {}", ex.getMessage());
        }
    }
}
