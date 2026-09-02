package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.config.AppProperties;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * In-memory registry of open Server-Sent Events connections.
 *
 * <p>Two audiences subscribe to the same queue: staff watching the board, and customers watching
 * their own ticket. Both are keyed by queue id, because every line movement affects all of them.
 *
 * <p><strong>Scaling note:</strong> emitters live in this JVM only, so with more than one instance a
 * customer would only receive updates produced by the instance holding their connection. Moving to
 * several replicas means fanning the {@code QueueChangedEvent} out through a shared broker
 * (Redis pub/sub, SNS, a managed WebSocket API) and having every instance push to its local
 * emitters. The rest of the application is stateless and needs no change for that.
 */
@Component
public class SseHub {

    private static final Logger log = LoggerFactory.getLogger(SseHub.class);

    private final Map<UUID, Set<SseEmitter>> staffSubscribers = new ConcurrentHashMap<>();
    private final Map<UUID, Map<UUID, Set<SseEmitter>>> ticketSubscribers = new ConcurrentHashMap<>();

    private final AppProperties properties;

    public SseHub(AppProperties properties) {
        this.properties = properties;
    }

    public SseEmitter subscribeStaff(UUID queueId) {
        SseEmitter emitter = newEmitter();
        Set<SseEmitter> emitters = staffSubscribers.computeIfAbsent(queueId, key -> new CopyOnWriteArraySet<>());
        emitters.add(emitter);
        registerCleanup(emitter, () -> removeStaff(queueId, emitter));
        return emitter;
    }

    public SseEmitter subscribeTicket(UUID queueId, UUID ticketToken) {
        SseEmitter emitter = newEmitter();
        ticketSubscribers
                .computeIfAbsent(queueId, key -> new ConcurrentHashMap<>())
                .computeIfAbsent(ticketToken, key -> new CopyOnWriteArraySet<>())
                .add(emitter);
        registerCleanup(emitter, () -> removeTicket(queueId, ticketToken, emitter));
        return emitter;
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

    private void removeStaff(UUID queueId, SseEmitter emitter) {
        staffSubscribers.computeIfPresent(queueId, (key, emitters) -> {
            emitters.remove(emitter);
            return emitters.isEmpty() ? null : emitters;
        });
    }

    private void removeTicket(UUID queueId, UUID ticketToken, SseEmitter emitter) {
        ticketSubscribers.computeIfPresent(queueId, (key, byTicket) -> {
            byTicket.computeIfPresent(ticketToken, (token, emitters) -> {
                emitters.remove(emitter);
                return emitters.isEmpty() ? null : emitters;
            });
            return byTicket.isEmpty() ? null : byTicket;
        });
    }
}
