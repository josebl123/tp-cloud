package ar.edu.itba.cloud.queue.service.notification;

/** A message ready to be handed to a transport. */
public record NotificationMessage(String destination, String subject, String body) {
}
