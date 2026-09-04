package ar.edu.itba.cloud.queue.realtime;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Decides <em>when</em> a queue's subscribers are refreshed, and makes sure only one refresh per
 * queue is ever in flight.
 *
 * <p>It exists for two reasons that turn out to be the same reason.
 *
 * <p><strong>Broadcasts must not run on the notification listener's thread.</strong> That thread's
 * job is to read from the database connection; if it also rebuilds queues and writes to sockets, then
 * every queue on the instance is serialised behind every other, and a single customer on a bad
 * connection - whose TCP window fills, blocking the write - stops updates for everyone. Work is
 * therefore handed to virtual threads, where a blocked write costs nothing but a parked thread.
 *
 * <p><strong>Once refreshes run in parallel, ordering has to be re-established.</strong> Without it,
 * two refreshes of the same queue could overlap and publish an older view after a newer one. The
 * per-queue state below prevents that: at most one refresh per queue runs at a time, and anything
 * arriving meanwhile only marks the queue dirty. Because the refresh always reads current state
 * rather than replaying an event, one refresh after ten changes is as correct as ten refreshes - it
 * is the same answer, sent once.
 *
 * <p>The short window in front of it is what turns a burst of arrivals into a single push.
 */
public class BroadcastCoordinator implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(BroadcastCoordinator.class);

    private final RealtimeBroadcaster broadcaster;
    private final long windowMillis;
    private final ScheduledExecutorService timer;
    private final ExecutorService workers;
    private final Map<UUID, QueueState> states = new ConcurrentHashMap<>();

    public BroadcastCoordinator(RealtimeBroadcaster broadcaster, Duration window) {
        this.broadcaster = broadcaster;
        this.windowMillis = Math.max(0, window.toMillis());
        // One platform thread, purely for timing - it must never do work that could block.
        this.timer = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "broadcast-timer");
            thread.setDaemon(true);
            return thread;
        });
        // The refreshes themselves: blocking socket writes are exactly what virtual threads are for.
        this.workers = Executors.newThreadPerTaskExecutor(
                Thread.ofVirtual().name("broadcast-", 0).factory());
    }

    /**
     * Notes that a queue has changed. Cheap, non-blocking, and safe to call as often as you like -
     * the coordinator decides how many of those calls become an actual refresh.
     */
    public void request(UUID queueId) {
        QueueState state = states.computeIfAbsent(queueId, key -> new QueueState());
        synchronized (state) {
            if (state.running) {
                // A refresh is mid-flight; it will be redone once, with whatever the state is then.
                state.dirty = true;
                return;
            }
            if (state.scheduled) {
                // Already inside the window - this change folds into the refresh that is coming.
                return;
            }
            state.scheduled = true;
        }
        schedule(queueId, state);
    }

    private void schedule(UUID queueId, QueueState state) {
        timer.schedule(() -> workers.execute(() -> refresh(queueId, state)),
                windowMillis, TimeUnit.MILLISECONDS);
    }

    private void refresh(UUID queueId, QueueState state) {
        synchronized (state) {
            state.scheduled = false;
            state.running = true;
            state.dirty = false;
        }
        try {
            broadcaster.broadcast(queueId);
        } catch (Exception ex) {
            // A failed refresh must not wedge the queue: the finally block still releases it.
            log.debug("Broadcast failed for queue {}: {}", queueId, ex.getMessage());
        } finally {
            boolean again;
            synchronized (state) {
                state.running = false;
                again = state.dirty;
                state.dirty = false;
                if (again) {
                    state.scheduled = true;
                }
            }
            if (again) {
                schedule(queueId, state);
            }
        }
    }

    /** Queues currently holding coordinator state. Exposed for tests and diagnostics. */
    public int trackedQueues() {
        return states.size();
    }

    @Override
    public void close() {
        timer.shutdownNow();
        workers.shutdown();
    }

    /** Guarded by its own monitor; one instance per queue. */
    private static final class QueueState {
        private boolean scheduled;
        private boolean running;
        private boolean dirty;
    }
}
