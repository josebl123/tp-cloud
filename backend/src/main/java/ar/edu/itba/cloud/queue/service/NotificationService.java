package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationChannel;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationRecord;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.NotificationRecordRepository;
import ar.edu.itba.cloud.queue.service.event.NotificationQueuedEvent;
import ar.edu.itba.cloud.queue.service.model.NotificationView;
import ar.edu.itba.cloud.queue.service.notification.NotificationSender;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Decides <em>whether</em> and <em>what</em> to notify. Actual delivery is
 * {@link ar.edu.itba.cloud.queue.service.notification.NotificationDispatcher}'s job, after the
 * transaction commits.
 *
 * <p>De-duplication is structural rather than time-based: the unique key
 * {@code (entry, type, notification cycle)} means a threshold alert fires exactly once per pass
 * through the line, no matter how many times the queue moves. When a customer is sent back to
 * WAITING after a no-show, the cycle advances and the alerts become eligible again.
 */
@Service
public class NotificationService {

    private static final int MAX_SUBJECT = 200;
    private static final int MAX_BODY = 2000;

    private final NotificationRecordRepository repository;
    private final EventRecorder eventRecorder;
    private final AppProperties properties;
    private final ApplicationEventPublisher publisher;
    private final List<NotificationSender> senders;
    private final EstimationService estimationService;
    private final Clock clock;

    public NotificationService(NotificationRecordRepository repository,
                               EventRecorder eventRecorder,
                               AppProperties properties,
                               ApplicationEventPublisher publisher,
                               List<NotificationSender> senders,
                               EstimationService estimationService,
                               Clock clock) {
        this.repository = repository;
        this.eventRecorder = eventRecorder;
        this.properties = properties;
        this.publisher = publisher;
        this.senders = senders;
        this.estimationService = estimationService;
        this.clock = clock;
    }

    /** Sent on join. This is the message that carries the personal follow-up link. */
    public void ticketCreated(QueueEntry entry, int position, Integer estimatedWaitMinutes) {
        ServiceQueue queue = entry.getQueue();
        String eta = estimatedWaitMinutes == null || estimatedWaitMinutes <= 0
                ? "en breve"
                : "en aproximadamente %d minutos".formatted(estimatedWaitMinutes);

        enqueue(entry, NotificationType.TICKET_CREATED,
                "Estas en la fila de %s".formatted(queue.getName()),
                """
                Hola %s, ya tenes tu lugar en la fila "%s" de %s.

                Numero de turno: %d
                Posicion actual: %d
                Tiempo estimado: %s

                Segui tu turno en tiempo real y avisanos si te vas:
                %s
                """.formatted(entry.getCustomerName(), queue.getName(),
                        queue.getEstablishment().getName(), entry.getTicketNumber(), position, eta,
                        properties.ticketUrl(entry.getTicketToken())));
    }

    /** Sent when the staff calls this customer. */
    public void yourTurn(QueueEntry entry) {
        ServiceQueue queue = entry.getQueue();
        String graceLine = queue.getGracePeriodSeconds() > 0
                ? "Tenes %d minutos para presentarte antes de perder tu lugar.".formatted(
                        Math.max(1, queue.getGracePeriodSeconds() / 60))
                : "Te esperamos.";

        enqueue(entry, NotificationType.YOUR_TURN,
                "Es tu turno en %s".formatted(queue.getName()),
                """
                Hola %s, es tu turno (numero %d) en "%s" de %s.

                %s

                %s
                """.formatted(entry.getCustomerName(), entry.getTicketNumber(), queue.getName(),
                        queue.getEstablishment().getName(), graceLine,
                        properties.ticketUrl(entry.getTicketToken())));
    }

    /** Sent when the grace period runs out, explaining what the establishment's policy did. */
    public void noShow(QueueEntry entry, NoShowPolicy policy, Integer newPosition) {
        ServiceQueue queue = entry.getQueue();
        String outcome = switch (policy) {
            case REMOVE -> "Lamentablemente perdiste tu lugar en la fila.";
            case MOVE_TO_END -> "Te reubicamos al final de la fila.";
            case MOVE_BACK -> "Te reubicamos %d lugares mas atras.".formatted(queue.getMoveBackPositions());
            case KEEP_POSITION -> "Conservaste tu lugar en la fila.";
        };
        String positionLine = newPosition == null ? "" : "%nTu nueva posicion es %d.".formatted(newPosition);

        enqueue(entry, NotificationType.NO_SHOW,
                "No pudimos atenderte en %s".formatted(queue.getName()),
                """
                Hola %s, se cumplio el tiempo de espera para presentarte en "%s".

                %s%s

                %s
                """.formatted(entry.getCustomerName(), queue.getName(), outcome, positionLine,
                        properties.ticketUrl(entry.getTicketToken())));
    }

    /** Sent to everyone still waiting when a queue is closed. */
    public void queueClosed(QueueEntry entry) {
        ServiceQueue queue = entry.getQueue();
        enqueue(entry, NotificationType.QUEUE_CLOSED,
                "Se cerro la fila de %s".formatted(queue.getName()),
                """
                Hola %s, la fila "%s" de %s fue cerrada y tu lugar ya no esta activo.

                Disculpa las molestias.
                """.formatted(entry.getCustomerName(), queue.getName(),
                        queue.getEstablishment().getName()));
    }

    /**
     * Fires the configured proximity alerts for everyone still waiting.
     *
     * @param waiting  the WAITING entries in service order
     * @param inService how many customers currently occupy a service station
     */
    public void evaluateThresholds(ServiceQueue queue, List<QueueEntry> waiting, long inService,
                                   Duration averageServiceTime) {
        Integer positionThreshold = queue.getNotifyAtPosition();
        Integer minutesThreshold = queue.getNotifyAtMinutes();
        if (positionThreshold == null && minutesThreshold == null) {
            return;
        }

        for (int index = 0; index < waiting.size(); index++) {
            QueueEntry entry = waiting.get(index);
            int peopleAhead = index;
            int estimatedMinutes = EstimationService.toMinutes(
                    estimationService.estimateWait(queue, peopleAhead, (int) inService, averageServiceTime));

            if (positionThreshold != null && peopleAhead <= positionThreshold) {
                enqueue(entry, NotificationType.APPROACHING_POSITION,
                        "Se acerca tu turno en %s".formatted(queue.getName()),
                        """
                        Hola %s, quedan %d persona(s) antes que vos en "%s" de %s.

                        Tiempo estimado: %d minuto(s).
                        %s
                        """.formatted(entry.getCustomerName(), peopleAhead, queue.getName(),
                                queue.getEstablishment().getName(), estimatedMinutes,
                                properties.ticketUrl(entry.getTicketToken())));
            }

            if (minutesThreshold != null && estimatedMinutes <= minutesThreshold) {
                enqueue(entry, NotificationType.APPROACHING_TIME,
                        "Faltan unos %d minutos para tu turno".formatted(estimatedMinutes),
                        """
                        Hola %s, tu turno en "%s" de %s seria en aproximadamente %d minuto(s).

                        Posicion actual: %d.
                        %s
                        """.formatted(entry.getCustomerName(), queue.getName(),
                                queue.getEstablishment().getName(), estimatedMinutes, peopleAhead + 1,
                                properties.ticketUrl(entry.getTicketToken())));
            }
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationView> forEntry(UUID entryId) {
        return repository.findAllByEntryIdOrderByCreatedAtAsc(entryId).stream()
                .map(record -> new NotificationView(record.getId(), record.getType(), record.getChannel(),
                        record.getStatus(), record.getDestination(), record.getSubject(),
                        record.getCreatedAt(), record.getSentAt()))
                .toList();
    }

    private void enqueue(QueueEntry entry, NotificationType type, String subject, String body) {
        if (repository.existsByEntryIdAndTypeAndCycle(entry.getId(), type, entry.getNotificationCycle())) {
            return;
        }

        NotificationChannel channel = resolveChannel(entry);
        String destination = destinationFor(entry, channel);

        NotificationRecord record = repository.save(new NotificationRecord(
                entry.getId(), type, entry.getNotificationCycle(), channel, destination,
                clip(subject, MAX_SUBJECT), clip(body, MAX_BODY), clock.instant()));

        eventRecorder.recordBySystem(entry.getQueue().getId(), entry.getId(), EventType.NOTIFICATION_SENT,
                "type=%s channel=%s".formatted(type, channel));
        publisher.publishEvent(new NotificationQueuedEvent(record.getId()));
    }

    /** Prefers a real transport when one is configured for a contact the customer actually gave. */
    private NotificationChannel resolveChannel(QueueEntry entry) {
        if (entry.getCustomerEmail() != null && isEnabled(NotificationChannel.EMAIL)) {
            return NotificationChannel.EMAIL;
        }
        if (entry.getCustomerPhone() != null && isEnabled(NotificationChannel.SMS)) {
            return NotificationChannel.SMS;
        }
        return NotificationChannel.LOG;
    }

    private String destinationFor(QueueEntry entry, NotificationChannel channel) {
        return switch (channel) {
            case EMAIL -> entry.getCustomerEmail();
            case SMS -> entry.getCustomerPhone();
            case LOG -> Optional.ofNullable(entry.getCustomerEmail())
                    .orElseGet(() -> Optional.ofNullable(entry.getCustomerPhone()).orElse("unknown"));
        };
    }

    private boolean isEnabled(NotificationChannel channel) {
        return senders.stream().anyMatch(sender -> sender.channel() == channel && sender.isEnabled());
    }

    private static String clip(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
