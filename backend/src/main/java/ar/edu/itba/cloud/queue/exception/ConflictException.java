package ar.edu.itba.cloud.queue.exception;

import org.springframework.http.HttpStatus;

/** The request is well-formed but clashes with the current state of the resource. */
public class ConflictException extends ApiException {

    public ConflictException(String code, String message) {
        super(HttpStatus.CONFLICT, code, message);
    }
}
