package ar.edu.itba.cloud.queue.service.notification;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationChannel;

/**
 * A transport that can deliver a notification.
 *
 * <p>The seam that keeps delivery swappable: today an SMTP server and a logger, tomorrow a managed
 * service (SES, SNS, a WhatsApp provider) with no change above this interface.
 */
public interface NotificationSender {

    NotificationChannel channel();

    /** Whether this transport is configured and usable right now. */
    boolean isEnabled();

    void send(NotificationMessage message) throws Exception;
}
