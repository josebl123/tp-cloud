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
    public void ticketCreated(QueueEntry entry, EstimationService.Simulation simulation) {
        ServiceQueue queue = entry.getQueue();
        Integer estimatedWaitMinutes = EstimationService.toMinutes(simulation.estimatedWait());
        String eta = estimatedWaitMinutes == null || estimatedWaitMinutes <= 0
                ? "any moment now"
                : "about %d minutes".formatted(estimatedWaitMinutes);

        enqueue(entry, NotificationType.TICKET_CREATED,
                "You're in the queue for %s".formatted(queue.getName()),
                """
                Hi %s, you have a place in the "%s" queue at %s.

                Ticket number: %d
                Groups scheduled before you: %d
                Groups currently in service: %d
                Place in your lane: %d
                Estimated wait: %s

                Follow your turn live, and let us know if you leave:
                %s
                """.formatted(entry.getCustomerName(), queue.getName(),
                        queue.getEstablishment().getName(), entry.getTicketNumber(), simulation.globalWaitingGroupsAhead(),
                        simulation.groupsInService(), simulation.lanePosition(), eta,
                        properties.ticketUrl(entry.getTicketToken())));
    }

    /** Sent when the staff calls this customer. */
    public void yourTurn(QueueEntry entry) {
        ServiceQueue queue = entry.getQueue();
        String graceLine = queue.getGracePeriodSeconds() > 0
                ? "You have %d minutes to come over before you lose your place.".formatted(
                        Math.max(1, queue.getGracePeriodSeconds() / 60))
                : "We're waiting for you.";

        enqueue(entry, NotificationType.YOUR_TURN,
                "It's your turn at %s".formatted(queue.getName()),
                """
                Hi %s, it's your turn (ticket %d) in "%s" at %s.

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
            case REMOVE -> "Unfortunately you have lost your place in the queue.";
            case MOVE_TO_END -> "We have moved you to the end of the queue.";
            case MOVE_BACK -> "We have moved you %d places further back.".formatted(queue.getMoveBackPositions());
            case KEEP_POSITION -> "You have kept your place in the queue.";
        };
        String positionLine = newPosition == null ? "" : "%nYour new position is %d.".formatted(newPosition);

        enqueue(entry, NotificationType.NO_SHOW,
                "We could not serve you at %s".formatted(queue.getName()),
                """
                Hi %s, the time to come over for "%s" ran out.

                %s%s

                %s
                """.formatted(entry.getCustomerName(), queue.getName(), outcome, positionLine,
                        properties.ticketUrl(entry.getTicketToken())));
    }

    /** Sent to everyone still waiting when a queue is closed. */
    public void queueClosed(QueueEntry entry) {
        ServiceQueue queue = entry.getQueue();
        enqueue(entry, NotificationType.QUEUE_CLOSED,
                "The %s queue has closed".formatted(queue.getName()),
                """
                Hi %s, the "%s" queue at %s has closed and your place is no longer active.

                Sorry for the inconvenience.
                """.formatted(entry.getCustomerName(), queue.getName(),
                        queue.getEstablishment().getName()));
    }

    /**
     * Fires the configured proximity alerts for everyone still waiting.
     *
     * @param waiting  the WAITING entries in service order
     * @param inService how many customers currently occupy a service station
     */
    public void evaluateThresholds(ServiceQueue queue, List<QueueEntry> waiting, List<QueueEntry> inService,
                                   Duration averageServiceTime) {
        Integer positionThreshold = queue.getNotifyAtPosition();
        Integer minutesThreshold = queue.getNotifyAtMinutes();
        if (positionThreshold == null && minutesThreshold == null) {
            return;
        }

        for (QueueEntry entry : waiting) {
            EstimationService.Simulation simulation = estimationService.estimate(queue, waiting, inService, entry, averageServiceTime);
            int groupsAhead = simulation.globalWaitingGroupsAhead();
            int estimatedMinutes = EstimationService.toMinutes(simulation.estimatedWait());

            if (positionThreshold != null && groupsAhead <= positionThreshold) {
                enqueue(entry, NotificationType.APPROACHING_POSITION,
                        "Your turn at %s is coming up".formatted(queue.getName()),
                        """
                        Hi %s, there are %d group(s) scheduled before you in "%s" at %s.

                        Estimated wait: %d minute(s).
                        %s
                        """.formatted(entry.getCustomerName(), groupsAhead, queue.getName(),
                                queue.getEstablishment().getName(), estimatedMinutes,
                                properties.ticketUrl(entry.getTicketToken())));
            }

            if (minutesThreshold != null && estimatedMinutes <= minutesThreshold) {
                enqueue(entry, NotificationType.APPROACHING_TIME,
                        "About %d minutes until your turn".formatted(estimatedMinutes),
                        """
                        Hi %s, your turn in "%s" at %s should come in about %d minute(s).

                        Groups scheduled before you: %d.
                        Place in your lane: %d.
                        %s
                        """.formatted(entry.getCustomerName(), queue.getName(),
                                queue.getEstablishment().getName(), estimatedMinutes,
                                simulation.globalWaitingGroupsAhead(), simulation.lanePosition(),
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

        eventRecorder.recordBySystem(entry.getQueue().getId(), entry.getId(), EventType.NOTIFICATION_QUEUED,
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
