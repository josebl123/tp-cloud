package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.config.AppProperties;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * In-memory registry of open Server-Sent Events connections.
 *
 * <p>Two audiences subscribe to the same queue: staff watching the board, and customers watching
 * their own ticket. Both are keyed by queue id, because every line movement affects all of them.
 *
 * <p><strong>Emitters are local to this JVM, and that is fine.</strong> A change made on another
 * instance still reaches these connections, because queue changes travel between instances through
 * PostgreSQL LISTEN/NOTIFY - see {@link RealtimeBus} and {@link PostgresNotificationListener}. Each
 * instance is told which queue moved and pushes to whichever of its own emitters care.
 */
@Component
public class SseHub {

    private static final Logger log = LoggerFactory.getLogger(SseHub.class);

    private final Map<UUID, Set<SseEmitter>> staffSubscribers = new ConcurrentHashMap<>();
    private final Map<UUID, Map<UUID, Set<SseEmitter>>> ticketSubscribers = new ConcurrentHashMap<>();

    // Kept as counters rather than walked on demand, so reading them stays O(1) however many are open.
    private final AtomicInteger staffConnections = new AtomicInteger();
    private final AtomicInteger ticketConnections = new AtomicInteger();

    private final AppProperties properties;

    public SseHub(AppProperties properties) {
        this.properties = properties;
    }

    public SseEmitter subscribeStaff(UUID queueId) {
        SseEmitter emitter = newEmitter();
        Set<SseEmitter> emitters = staffSubscribers.computeIfAbsent(queueId, key -> new CopyOnWriteArraySet<>());
        emitters.add(emitter);
        staffConnections.incrementAndGet();
        registerCleanup(emitter, () -> removeStaff(queueId, emitter));
        return emitter;
    }

    public SseEmitter subscribeTicket(UUID queueId, UUID ticketToken) {
        SseEmitter emitter = newEmitter();
        ticketSubscribers
                .computeIfAbsent(queueId, key -> new ConcurrentHashMap<>())
                .computeIfAbsent(ticketToken, key -> new CopyOnWriteArraySet<>())
                .add(emitter);
        ticketConnections.incrementAndGet();
        registerCleanup(emitter, () -> removeTicket(queueId, ticketToken, emitter));
        return emitter;
    }

    /** Staff board streams this instance is holding right now. */
    public int staffConnections() {
        return staffConnections.get();
    }

    /** Customer ticket streams this instance is holding right now. */
    public int ticketConnections() {
        return ticketConnections.get();
    }

    public boolean hasStaffSubscribers(UUID queueId) {
        Set<SseEmitter> emitters = staffSubscribers.get(queueId);
        return emitters != null && !emitters.isEmpty();
    }

    /** Ticket tokens currently watching this queue. */
    public Set<UUID> subscribedTickets(UUID queueId) {
        Map<UUID, Set<SseEmitter>> byTicket = ticketSubscribers.get(queueId);
        return byTicket == null ? Set.of() : Set.copyOf(byTicket.keySet());
    }

    public void sendToStaff(UUID queueId, String eventName, Object payload) {
        send(staffSubscribers.get(queueId), eventName, payload);
    }

    public void sendToTicket(UUID queueId, UUID ticketToken, String eventName, Object payload) {
        Map<UUID, Set<SseEmitter>> byTicket = ticketSubscribers.get(queueId);
        if (byTicket != null) {
            send(byTicket.get(ticketToken), eventName, payload);
        }
    }

    /** Sends one payload on a single emitter, typically the initial state right after subscribing. */
    public void sendInitial(SseEmitter emitter, String eventName, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(eventName).data(payload));
        } catch (IOException | IllegalStateException ex) {
            log.debug("Could not deliver initial SSE payload: {}", ex.getMessage());
            emitter.complete();
        }
    }

    /** How many connections this instance is currently holding. Surfaced on the info endpoint. */
    public int openConnections() {
        int staff = staffSubscribers.values().stream().mapToInt(Set::size).sum();
        int tickets = ticketSubscribers.values().stream()
                .flatMap(byTicket -> byTicket.values().stream())
                .mapToInt(Set::size)
                .sum();
        return staff + tickets;
    }

    /**
     * Closes every stream when the application is shutting down.
     *
     * <p>Matters on an Auto Scaling Group: when an instance is being terminated its clients should be
     * released immediately so they reconnect through the load balancer to a surviving instance,
     * rather than sitting on a dead connection until their own timeout expires. Runs on
     * {@link ContextClosedEvent}, which fires before the graceful-shutdown wait, so these long-lived
     * requests do not hold that wait open for its full duration either.
     */
    @EventListener(ContextClosedEvent.class)
    public void releaseAll() {
        int released = openConnections();
        staffSubscribers.values().forEach(emitters -> emitters.forEach(SseEmitter::complete));
        ticketSubscribers.values()
                .forEach(byTicket -> byTicket.values()
                        .forEach(emitters -> emitters.forEach(SseEmitter::complete)));
        staffSubscribers.clear();
        ticketSubscribers.clear();
        if (released > 0) {
            log.info("Released {} live connections for shutdown", released);
        }
    }

    /** Keeps idle connections from being reaped by intermediaries. */
    public void heartbeat() {
        staffSubscribers.values().forEach(this::ping);
        ticketSubscribers.values().forEach(byTicket -> byTicket.values().forEach(this::ping));
    }

    private void ping(Set<SseEmitter> emitters) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().comment("ping"));
            } catch (IOException | IllegalStateException ex) {
                // A browser navigating away commonly closes the SSE socket between heartbeats.
                // Complete normally so it is removed without reaching the global exception handler.
                emitter.complete();
            }
        }
    }

    private void send(Set<SseEmitter> emitters, String eventName, Object payload) {
        if (emitters == null || emitters.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(payload));
            } catch (IOException | IllegalStateException ex) {
                log.debug("Dropping SSE subscriber: {}", ex.getMessage());
                emitter.complete();
            }
        }
    }

    private SseEmitter newEmitter() {
        return new SseEmitter(properties.sse().timeout().toMillis());
    }

    private void registerCleanup(SseEmitter emitter, Runnable cleanup) {
        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            emitter.complete();
        });
        emitter.onError(error -> cleanup.run());
    }

    // Package-private, not private: the emitter callbacks that normally invoke these are fired by the
    // MVC async infrastructure, so a test has no other way to exercise the cleanup path.
    void removeStaff(UUID queueId, SseEmitter emitter) {
        staffSubscribers.computeIfPresent(queueId, (key, emitters) -> {
            if (emitters.remove(emitter)) {
                staffConnections.decrementAndGet();
            }
            return emitters.isEmpty() ? null : emitters;
        });
    }

    void removeTicket(UUID queueId, UUID ticketToken, SseEmitter emitter) {
        ticketSubscribers.computeIfPresent(queueId, (key, byTicket) -> {
            byTicket.computeIfPresent(ticketToken, (token, emitters) -> {
                if (emitters.remove(emitter)) {
                    ticketConnections.decrementAndGet();
                }
                return emitters.isEmpty() ? null : emitters;
            });
            return byTicket.isEmpty() ? null : byTicket;
        });
    }
}
