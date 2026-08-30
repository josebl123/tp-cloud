package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

public class NotFoundException extends ApiException {

    public NotFoundException(String code, String message) {
        super(HttpStatus.NOT_FOUND, code, message);
    }

    public static NotFoundException queue(Object id) {
        return new NotFoundException("QUEUE_NOT_FOUND", "Queue %s does not exist".formatted(id));
    }

    public static NotFoundException entry(Object id) {
        return new NotFoundException("ENTRY_NOT_FOUND", "Queue entry %s does not exist".formatted(id));
    }

    public static NotFoundException ticket() {
        return new NotFoundException("TICKET_NOT_FOUND", "This ticket does not exist");
    }

    public static NotFoundException establishment(Object id) {
        return new NotFoundException("ESTABLISHMENT_NOT_FOUND", "Establishment %s does not exist".formatted(id));
    }

    public static NotFoundException user(Object id) {
        return new NotFoundException("USER_NOT_FOUND", "User %s does not exist".formatted(id));
    }
}
